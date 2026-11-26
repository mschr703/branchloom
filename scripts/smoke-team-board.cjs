const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { StudioStore } = require('../dist-main/main/store');
const { createTeamBoardInvite, revokeTeamBoardInvite, teamBoardCardComments, teamBoardComments } = require('../dist-main/main/team-board');
const { acknowledgeGuestInboxComment, reviewInboxItems } = require('../dist-main/main/review-inbox');
const { globalInboxItems } = require('../dist-main/main/global-inbox');
const { TeamBoardHttp } = require('../dist-main/main/team-board-http');
const { activeTailnetIPv4 } = require('../dist-main/main/team-review-tailnet');

const root = process.env.BRANCHLOOM_TEAM_BOARD_SMOKE_ROOT;
if (!root || !resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('An isolated smoke profile is required.');
app.setPath('userData', root);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { process.stderr.write('TEAM_BOARD_SMOKE_TIMEOUT\n'); app.exit(1); }, 90_000);

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await check()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

app.whenReady().then(async () => {
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const windows = [];
  let listener = null;
  try {
    const host = process.argv.includes('--tailnet') ? await activeTailnetIPv4() : '127.0.0.1';
    listener = new TeamBoardHttp(store, host);
    const project = store.createProject({ name: 'Synthetic team project', path: root });
    const columns = store.snapshot(project.id).columns;
    const column = columns[0];
    const feedbackCard = store.createCard({ projectId: project.id, columnId: column.id, title: 'Review settings', description: 'Not shared with guests' });
    store.createCard({ projectId: project.id, columnId: column.id, title: 'Clarify invite copy', priority: 'medium' });
    store.createCard({ projectId: project.id, columnId: columns[1].id, title: 'Plan team permissions' });
    const active = store.createCard({ projectId: project.id, columnId: columns[2].id, title: 'Build read-only board', priority: 'high' });
    store.createSession({ cardId: active.id, agentId: store.agents()[0].id });
    store.createCard({ projectId: project.id, columnId: columns[3].id, title: 'Check guest view' });
    const alex = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Alex' });
    const sam = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Sam' });
    const taylor = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Taylor', canComment: true });
    listener.allowSecret(alex.secret); listener.allowSecret(sam.secret); listener.allowSecret(taylor.secret);
    await listener.start();
    const openGuest = async (secret, partition) => {
      const window = new BrowserWindow({ show: false, width: 1250, height: 810,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition } });
      windows.push(window);
      await window.loadURL(listener.url(secret));
      await waitFor(() => window.webContents.executeJavaScript("document.getElementById('project').textContent === 'Synthetic team project' && document.getElementById('board').textContent.includes('Review settings')"), 'guest board');
      return window;
    };
    const alexWindow = await openGuest(alex.secret, 'team-board-alex');
    const samWindow = await openGuest(sam.secret, 'team-board-sam');
    const taylorWindow = await openGuest(taylor.secret, 'team-board-taylor');
    if (await samWindow.webContents.executeJavaScript('document.querySelectorAll(".comment-action").length')) throw new Error('Read-only guest received comment controls.');
    await taylorWindow.webContents.executeJavaScript(`(() => {
      const findCard = () => [...document.querySelectorAll('.card')].find((item) => item.textContent.includes('Review settings'));
      findCard().querySelector('.comment-action').click();
      const first = findCard();
      const field = first.querySelector('textarea');
      field.value = 'Please check the empty state.';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    if (process.env.BRANCHLOOM_TEAM_BOARD_COMMENT_SCREENSHOT) {
      await taylorWindow.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      writeFileSync(process.env.BRANCHLOOM_TEAM_BOARD_COMMENT_SCREENSHOT, (await taylorWindow.capturePage()).toPNG());
    }
    await taylorWindow.webContents.executeJavaScript(`(() => {
      const originalFetch = window.fetch.bind(window);
      let dropped = false;
      window.fetch = (...args) => {
        if (!dropped && args[1]?.method === 'POST') {
          dropped = true;
          return originalFetch(...args).then(() => { throw new Error('Synthetic response loss'); });
        }
        return originalFetch(...args);
      };
      [...document.querySelectorAll('.card')].find((item) => item.textContent.includes('Review settings')).querySelector('form').requestSubmit();
    })()`);
    await waitFor(() => teamBoardComments(store, project.id).length === 1, 'comment from guest browser');
    await waitFor(() => taylorWindow.webContents.executeJavaScript("document.body.textContent.includes('Senden nicht bestätigt')"), 'retry prompt after lost response');
    await taylorWindow.webContents.executeJavaScript("[...document.querySelectorAll('.card')].find((item) => item.textContent.includes('Review settings')).querySelector('form').requestSubmit()");
    await waitFor(() => taylorWindow.webContents.executeJavaScript("document.getElementById('updated').textContent === 'Kommentar gesendet'"), 'idempotent comment retry');
    if (teamBoardComments(store, project.id).length !== 1) throw new Error('Lost-response retry duplicated the guest comment.');
    if (teamBoardComments(store, project.id)[0].displayName !== 'Taylor') throw new Error('Guest comment was attributed to the wrong invitation.');
    const comment = teamBoardComments(store, project.id)[0];
    if (!reviewInboxItems(store, { projectId: project.id }).items.some((item) => item.id === comment.id && item.sourceId === feedbackCard.id)) throw new Error('Guest feedback is missing from the project inbox.');
    if (!globalInboxItems(store, { category: 'review' }).items.some((item) => item.id === `guest:${comment.id}`)) throw new Error('Guest feedback is missing from the global inbox.');
    if (teamBoardCardComments(store, { projectId: project.id, cardId: feedbackCard.id })[0]?.body !== comment.body) throw new Error('Guest feedback is missing from its source card.');
    acknowledgeGuestInboxComment(store, { projectId: project.id, commentId: comment.id });
    if (reviewInboxItems(store, { projectId: project.id }).items.some((item) => item.id === comment.id) || globalInboxItems(store).items.some((item) => item.id === `guest:${comment.id}`)) throw new Error('Read guest feedback still appears in the inbox.');
    if (teamBoardCardComments(store, { projectId: project.id, cardId: feedbackCard.id }).length !== 1) throw new Error('Acknowledgement deleted the original guest feedback.');
    if (await samWindow.webContents.executeJavaScript('typeof window.studio !== "undefined"')) throw new Error('Guest has host IPC access.');
    if (await samWindow.webContents.executeJavaScript("document.body.textContent.includes('Not shared with guests')")) throw new Error('Private card description reached the guest.');
    if (process.env.BRANCHLOOM_TEAM_BOARD_SCREENSHOT) {
      const screenshot = await samWindow.capturePage();
      writeFileSync(process.env.BRANCHLOOM_TEAM_BOARD_SCREENSHOT, screenshot.toPNG());
    }
    store.createCard({ projectId: project.id, columnId: column.id, title: 'New task from host' });
    await samWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('online'))");
    await waitFor(() => samWindow.webContents.executeJavaScript("document.getElementById('board').textContent.includes('New task from host')"), 'updated guest board');
    const endpoint = listener.url(sam.secret).replace('/board/', '/api/board/');
    if ((await fetch(endpoint, { method: 'POST' })).status !== 405) throw new Error('Guest could send a write request.');
    revokeTeamBoardInvite(store, { projectId: project.id, inviteId: alex.invite.id });
    await alexWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('online'))");
    await waitFor(() => alexWindow.webContents.executeJavaScript("document.getElementById('message').textContent.includes('nicht mehr verfügbar') && !document.getElementById('board').children.length"), 'revoked guest access');
    if ((await fetch(endpoint)).status !== 200) throw new Error('Independent guest lost access.');
    process.stdout.write('TEAM_BOARD_SMOKE_OK\n');
  } catch (error) {
    process.stderr.write(`TEAM_BOARD_SMOKE_FAILED: ${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    listener?.close();
    store.close();
    app.exit(process.exitCode || 0);
  }
}).catch((error) => { process.stderr.write(`TEAM_BOARD_SMOKE_FAILED: ${error.stack || error}\n`); app.exit(1); });
