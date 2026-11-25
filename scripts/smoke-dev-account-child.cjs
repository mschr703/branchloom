const { app, BrowserWindow, safeStorage } = require('electron');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { StudioStore } = require('../dist-main/main/store.js');
const { DevAccountBrowser } = require('../dist-main/main/dev-account-browser.js');
const { assignDevAccount, createDevAccount, devAccountOverview, savedDevLogin } = require('../dist-main/main/dev-account.js');

const root = process.env.BRANCHLOOM_ACCOUNT_RESTART_DIR;
const port = Number(process.env.BRANCHLOOM_ACCOUNT_RESTART_PORT);
const phase = process.argv[2];
if (!root || !Number.isInteger(port) || !['first', 'second'].includes(phase)) process.exit(2);
app.setPath('userData', root);

app.whenReady().then(async () => {
  if (!await safeStorage.isAsyncEncryptionAvailable()) throw new Error('OS-protected storage unavailable.');
  const store = new StudioStore(join(root, 'studio.sqlite'));
  let parent;
  let browser;
  try {
    let state;
    if (phase === 'first') {
      const source = join(root, 'source'); mkdirSync(source, { recursive: true });
      const project = store.createProject({ name: 'Synthetic account restart', path: source });
      const columnId = store.snapshot(project.id).columns[0].id;
      const adminCard = store.createCard({ projectId: project.id, columnId, title: 'Synthetic admin' });
      const userCard = store.createCard({ projectId: project.id, columnId, title: 'Synthetic user' });
      const admin = createDevAccount(store, { projectId: project.id, service: 'Fixture', environment: 'local', role: 'admin', subject: 'admin-fixture', probePath: '/api/me' });
      const user = createDevAccount(store, { projectId: project.id, service: 'Fixture', environment: 'local', role: 'user', subject: 'user-fixture', probePath: '/api/me' });
      for (const [cardId, accountId] of [[adminCard.id, admin.id], [userCard.id, user.id]]) {
        assignDevAccount(store, { projectId: project.id, cardId, accountId, expectedCardRevision: devAccountOverview(store, { projectId: project.id, cardId }).cardRevision });
      }
      state = { projectId: project.id, adminCardId: adminCard.id, userCardId: userCard.id, adminId: admin.id, userId: user.id };
      writeFileSync(join(root, 'fixture-state.json'), JSON.stringify(state));
    } else state = JSON.parse(readFileSync(join(root, 'fixture-state.json'), 'utf8'));

    const runs = new Map([[state.adminCardId, 'admin-run'], [state.userCardId, 'user-run']].map(([cardId, id]) =>
      [cardId, { id, cardId, projectId: state.projectId, url: `http://127.0.0.1:${port}/`, port, state: 'ready', managed: true }]));
    const environments = {
      card: (cardId) => runs.get(cardId) ?? null,
      verifyCurrentPreview: (cardId, expectedRunId) => {
        const run = runs.get(cardId);
        if (!run || run.id !== expectedRunId) throw new Error('Preview changed before account use.');
        return run;
      },
      verifyCurrentPreviewAsync: async (cardId, expectedRunId) => {
        const run = runs.get(cardId);
        if (!run || run.id !== expectedRunId) throw new Error('Preview changed before account use.');
        return run;
      },
    };
    parent = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    browser = new DevAccountBrowser(store, environments, () => parent);

    if (phase === 'first') {
      for (const [cardId, role] of [[state.adminCardId, 'admin'], [state.userCardId, 'user']]) {
        await browser.open(cardId);
        const child = BrowserWindow.getAllWindows().find((item) => item.getParentWindow() === parent && item.webContents.getURL() === `http://127.0.0.1:${port}/`);
        if (!child) throw new Error('Account window did not open.');
        await child.loadURL(`http://127.0.0.1:${port}/login?as=${role}`);
        if ((await browser.probe(cardId)).state !== 'verified') throw new Error('Visible fixture login was not verified.');
        if ((await browser.saveLogin(cardId)).state !== 'saved') throw new Error('Explicit login save failed.');
      }
      for (const accountId of [state.adminId, state.userId]) {
        const sealed = savedDevLogin(store, accountId)?.sealed;
        if (!sealed || sealed.includes(Buffer.from('synthetic-cookie-secret'))) throw new Error('Saved login was not sealed.');
      }
    } else {
      if (browser.savedLoginStatus(state.adminCardId).state !== 'saved' || browser.savedLoginStatus(state.userCardId).state !== 'saved') throw new Error('Saved login metadata did not survive restart.');
      if ((await browser.probe(state.adminCardId)).state !== 'verified' || (await browser.probe(state.userCardId)).state !== 'verified') throw new Error('Both protected logins did not restore after process and port restart.');
      await browser.forget(state.adminId);
      if ((await browser.probe(state.adminCardId)).state !== 'login-required' || (await browser.probe(state.userCardId)).state !== 'verified') throw new Error('Targeted forget affected the wrong account.');
      assignDevAccount(store, { projectId: state.projectId, cardId: state.userCardId, accountId: null,
        expectedCardRevision: devAccountOverview(store, { projectId: state.projectId, cardId: state.userCardId }).cardRevision });
      try { await browser.probe(state.userCardId); throw new Error('Revoked card retained its account.'); }
      catch (error) { if (!String(error.message).includes('No development account')) throw error; }
    }
    process.stdout.write(`ACCOUNT_RESTART_${phase.toUpperCase()}_OK\n`);
  } finally {
    browser?.dispose();
    if (parent && !parent.isDestroyed()) parent.destroy();
    store.close();
    app.quit();
  }
}).catch((error) => {
  console.error('Account restart smoke failed:', error instanceof Error ? error.message : 'unknown error');
  app.exit(1);
});
