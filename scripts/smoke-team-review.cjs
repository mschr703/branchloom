const { app, BrowserWindow } = require('electron');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { StudioStore } = require('../dist-main/main/store');
const { createTeamReviewRoom, createTeamReviewInvite, revokeTeamReviewInvite, teamReviewComments } = require('../dist-main/main/team-review');
const { TeamReviewHttp } = require('../dist-main/main/team-review-http');
const { activeTailnetIPv4 } = require('../dist-main/main/team-review-tailnet');

const root = process.env.BRANCHLOOM_TEAM_REVIEW_SMOKE_ROOT;
if (!root) throw new Error('Isolated smoke profile path is required.');
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected smoke profile path.');
app.setPath('userData', root);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { process.stderr.write('TEAM_REVIEW_SMOKE_TIMEOUT\n'); app.exit(1); }, 90_000);

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
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
    const tailnet = process.argv.includes('--tailnet');
    const host = tailnet ? await activeTailnetIPv4() : '127.0.0.1';
    listener = new TeamReviewHttp(store, host, tailnet ? new Set() : null);
    const project = store.createProject({ name: 'Synthetic review', path: root });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0].id, title: 'Review settings' });
    const reportId = 'synthetic-review-report';
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/GxQAAAAASUVORK5CYII=', 'base64');
    store.db.prepare(`INSERT INTO card_qa_reports
      (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json, viewport_width, viewport_height, git_evidence_json, screenshot_png)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(reportId, card.id, project.id, 'http://127.0.0.1:5181/settings',
      '2026-01-01T10:00:00Z', '2026-01-01T10:00:05Z', 'passed', '[]', 1200, 800, 'null', image);
    const room = createTeamReviewRoom(store, { projectId: project.id, cardId: card.id, qaReportId: reportId, scenario: 'Settings without sign-in', reviewerName: 'Alex' });
    const alexInvite = tailnet ? createTeamReviewInvite(store, { roomId: room.room.id, reviewerName: 'Alex remote' }) : room;
    const second = createTeamReviewInvite(store, { roomId: room.room.id, reviewerName: 'Sam' });
    if (tailnet) { listener.allowSecret(alexInvite.reviewerSecret); listener.allowSecret(second.reviewerSecret); }
    await listener.start();
    if (tailnet) {
      const denied = await fetch(`${new URL(listener.reviewUrl(alexInvite.reviewerSecret)).origin}/r/${room.reviewerSecret}`);
      if (denied.status !== 403) throw new Error('Local-only invitation was accepted on the tailnet listener.');
    }
    const openGuest = async (secret, partition) => {
      const window = new BrowserWindow({ show: false, width: 1200, height: 800,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition } });
      windows.push(window);
      await window.loadURL(listener.reviewUrl(secret));
      await waitFor(() => window.webContents.executeJavaScript("document.getElementById('scenario').textContent === 'Settings without sign-in'"), 'guest review heading');
      return window;
    };
    const alex = await openGuest(alexInvite.reviewerSecret, 'team-review-alex');
    const sam = await openGuest(second.reviewerSecret, 'team-review-sam');
    const hasHostApi = await sam.webContents.executeJavaScript('typeof window.studio !== "undefined"');
    if (hasHostApi) throw new Error('Guest browser unexpectedly has host IPC access.');
    await alex.webContents.executeJavaScript(`(() => {
      const image = document.getElementById('review-image');
      const bounds = image.getBoundingClientRect();
      image.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + bounds.width * 0.25, clientY: bounds.top + bounds.height * 0.75 }));
      document.getElementById('comment-body').value = 'Clarify the notification label';
      document.getElementById('comment-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`);
    await waitFor(() => teamReviewComments(store, room.room.id).length === 1, 'saved browser comment');
    await sam.webContents.executeJavaScript("window.dispatchEvent(new Event('online'))");
    await waitFor(() => sam.webContents.executeJavaScript("document.querySelector('#comments li')?.textContent.includes('Clarify the notification label')"), 'comment in second browser');
    revokeTeamReviewInvite(store, { roomId: room.room.id, inviteId: second.invite.id });
    await sam.webContents.executeJavaScript("window.dispatchEvent(new Event('online'))");
    await waitFor(() => sam.webContents.executeJavaScript("document.getElementById('room-state').textContent === 'Invitation unavailable'"), 'revoked browser access');
    const oldImageVisible = await sam.webContents.executeJavaScript("document.getElementById('review-image').hasAttribute('src')");
    if (oldImageVisible) throw new Error('Revoked guest still has the image in the page.');
    process.stdout.write('TEAM_REVIEW_SMOKE_OK\n');
  } catch (error) {
    process.stderr.write(`TEAM_REVIEW_SMOKE_FAILED: ${error.stack || error}\n`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    listener?.close();
    store.close();
    app.exit(process.exitCode || 0);
  }
}).catch((error) => { process.stderr.write(`TEAM_REVIEW_SMOKE_FAILED: ${error.stack || error}\n`); app.exit(1); });
