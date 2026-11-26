const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { StudioStore } = require('../dist-main/main/store');
const { createTeamBoardInvite, revokeTeamBoardInvite } = require('../dist-main/main/team-board');
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
    store.createCard({ projectId: project.id, columnId: column.id, title: 'Review settings', description: 'Not shared with guests' });
    store.createCard({ projectId: project.id, columnId: column.id, title: 'Clarify invite copy', priority: 'medium' });
    store.createCard({ projectId: project.id, columnId: columns[1].id, title: 'Plan team permissions' });
    const active = store.createCard({ projectId: project.id, columnId: columns[2].id, title: 'Build read-only board', priority: 'high' });
    store.createSession({ cardId: active.id, agentId: store.agents()[0].id });
    store.createCard({ projectId: project.id, columnId: columns[3].id, title: 'Check guest view' });
    const alex = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Alex' });
    const sam = createTeamBoardInvite(store, { projectId: project.id, displayName: 'Sam' });
    listener.allowSecret(alex.secret); listener.allowSecret(sam.secret);
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
