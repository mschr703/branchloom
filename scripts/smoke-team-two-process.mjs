import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const Y = require('yjs');
const root = mkdtempSync(join(tmpdir(), 'branchloom-two-process-team-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Smoke root escaped the temp folder.');
const projectPath = join(root, 'project');
mkdirSync(projectPath);
const children = new Set();
const deadline = Date.now() + 180_000;
const crashOwner = process.argv.includes('--crash-owner');

function delay(ms) { return new Promise((resolveDelay) => setTimeout(resolveDelay, ms)); }
function draftText(snapshot) {
  const document = new Y.Doc();
  if (snapshot.update) Y.applyUpdate(document, Buffer.from(snapshot.update, 'base64'));
  const value = document.getText('body').toString();
  document.destroy();
  return value;
}
async function waitFor(check, label, timeoutMs = 12_000) {
  const limit = Math.min(Date.now() + timeoutMs, deadline);
  while (Date.now() < limit) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

class DebugPage {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Electron debugging connection closed.'));
      this.pending.clear();
    });
  }
  command(method, params) {
    const id = this.nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' +
      (result.exceptionDetails.exception?.description ?? 'unknown renderer exception'));
    return result.result?.value;
  }
  reload() { return this.command('Page.reload', { ignoreCache: true }); }
  close() { this.socket.close(); }
}

async function launch(profileName) {
  const port = await freePort();
  const profile = join(root, profileName);
  const child = spawn(electron, ['.', `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JARVIS_STUDIO_DEV_SERVER: '0', BRANCHLOOM_DEV_USER_DATA: profile },
  });
  children.add(child);
  let recentStderr = '';
  child.stderr.on('data', (chunk) => { recentStderr = (recentStderr + chunk).slice(-4000); });
  child.once('exit', () => children.delete(child));
  const pageUrl = await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`${profileName} exited before its renderer was ready: ${recentStderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      return pages.find((page) => page.type === 'page' && page.url?.includes('renderer/index.html'))?.webSocketDebuggerUrl;
    } catch { return null; }
  }, `${profileName} Electron renderer`, 20_000);
  const socket = new WebSocket(pageUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  const page = new DebugPage(socket);
  await waitFor(() => page.evaluate('typeof window.studio === "object" && Boolean(document.querySelector("#project-select"))'),
    `${profileName} preload and project selector`);
  return { child, page, profile };
}

async function stop(instance, force = false) {
  if (!instance) return;
  if (instance.child.exitCode !== null) return;
  const closed = new Promise((resolveExit) => instance.child.once('exit', resolveExit));
  if (!force) {
    try { await instance.page.evaluate('window.close()'); } catch { /* The renderer may close before CDP replies. */ }
    await Promise.race([closed, delay(3_000)]);
  }
  if (instance.child.exitCode === null) instance.child.kill();
  await Promise.race([closed, delay(1_000)]);
  instance.page.close();
}

const waitForText = async (page, marker) => {
  try {
    return await waitFor(() => page.evaluate(`document.querySelector('.team-card-draft textarea')?.value.includes(${JSON.stringify(marker)})`),
      marker, 30_000);
  } catch (error) {
    const diagnostic = await page.evaluate(`({ value: document.querySelector('.team-card-draft textarea')?.value,
      presence: document.querySelector('.team-card-presence')?.textContent,
      error: document.querySelector('.team-card-draft .inline-error')?.textContent })`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
  }
};
const navigateTeam = async (page) => {
  try { await waitFor(() => page.evaluate(`Boolean([...document.querySelectorAll('button')]
    .find((button) => button.getAttribute('aria-label') === 'Team' || button.textContent.trim() === 'Team öffnen'))`), 'team navigation'); }
  catch (error) {
    const debug = await page.evaluate(`({ text: document.body.textContent.slice(0, 700),
      nav: [...document.querySelectorAll('nav button')].map((button) => button.getAttribute('aria-label')) })`);
    throw new Error(`${error.message}: ${JSON.stringify(debug)}`);
  }
  await page.evaluate(`[...document.querySelectorAll('button')]
    .find((button) => button.getAttribute('aria-label') === 'Team' || button.textContent.trim() === 'Team öffnen').click()`);
  try { await waitFor(() => page.evaluate('Boolean(document.querySelector(".team-workspace-page"))'), 'team page'); }
  catch (error) {
    const debug = await page.evaluate(`({ text: document.body.textContent.slice(0, 700),
      nav: [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].map((button) => button.getAttribute('aria-label')) })`);
    throw new Error(`${error.message}: ${JSON.stringify(debug)}`);
  }
};
const openDraft = async (page, title) => {
  try { await waitFor(() => page.evaluate(`Boolean([...document.querySelectorAll('.team-workspace-card')]
    .find((card) => card.textContent.includes(${JSON.stringify(title)})))`), `${title} in shared board`, 15_000); }
  catch (error) { throw new Error(`${error.message}: ${JSON.stringify(await page.evaluate(`({
    text: document.body.textContent.slice(0, 900), selected: document.querySelector('#project-select')?.value })`))}`); }
  await page.evaluate(`[...document.querySelectorAll('.team-workspace-card')]
    .find((card) => card.textContent.includes(${JSON.stringify(title)})).click()`);
  await waitFor(() => page.evaluate('Boolean(document.querySelector(".team-card-draft textarea:not(:disabled)"))'),
    'editable shared draft');
};
const typeDraft = (page, addition) => page.evaluate(`(() => {
  const field = document.querySelector('.team-card-draft textarea');
  if (!(field instanceof HTMLTextAreaElement) || field.disabled) throw new Error('The shared editor is unavailable.');
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  setter.call(field, field.value + ${JSON.stringify(addition)});
  field.dispatchEvent(new Event('input', { bubbles: true }));
  return field.value;
})()`);

let owner;
let member;
try {
  owner = await launch('owner');
  const project = await owner.page.evaluate(`window.studio.createProject({ name: 'Two-process planning', path: ${JSON.stringify(projectPath)} })`);
  const board = await owner.page.evaluate(`window.studio.snapshot(${JSON.stringify(project.id)})`);
  const card = await owner.page.evaluate(`window.studio.createCard({ projectId: ${JSON.stringify(project.id)},
    columnId: ${JSON.stringify(board.columns[0].id)}, title: 'Shared two-client card', description: 'Accepted description' })`);
  const hosted = await owner.page.evaluate(`window.studio.createLocalTeamWorkspace({
    projectId: ${JSON.stringify(project.id)}, workspaceName: 'Two-process team', ownerName: 'Owner' })`);
  const invite = await owner.page.evaluate(`window.studio.inviteTeamMember({ projectId: ${JSON.stringify(project.id)}, role: 'editor' })`);
  await owner.page.reload();
  try { await waitFor(() => owner.page.evaluate(`Boolean(document.querySelector('#project-select option[value=${JSON.stringify(project.id)}]'))`),
    'new owner project after reload'); }
  catch (error) { throw new Error(`${error.message}: ${JSON.stringify(await owner.page.evaluate(`({
    text: document.body.textContent.slice(0, 700), options: [...document.querySelectorAll('#project-select option')]
      .map((item) => ({ text: item.textContent, value: item.value })) })`))}`); }
  await owner.page.evaluate(`(() => {
    const picker = document.querySelector('#project-select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(picker, ${JSON.stringify(project.id)});
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await navigateTeam(owner.page);
  await openDraft(owner.page, card.title);

  member = await launch('member');
  const joined = await member.page.evaluate(`window.studio.joinTeam({ coordinatorUrl: ${JSON.stringify(invite.coordinatorUrl)},
    inviteSecret: ${JSON.stringify(invite.inviteSecret)}, displayName: 'Member' })`);
  if (joined.workspaceId !== hosted.workspaceId || joined.memberId === hosted.members[0]?.id) {
    throw new Error('The second app did not obtain an independent member identity.');
  }
  await member.page.reload();
  await waitFor(() => member.page.evaluate('typeof window.studio === "object" && Boolean(document.querySelector("#project-select"))'),
    'member reload');
  await navigateTeam(member.page);
  await waitFor(() => member.page.evaluate(`Boolean(document.querySelector('.team-open-shared-board'))`),
    'member shared board entry');
  await member.page.evaluate(`document.querySelector('.team-open-shared-board').click()`);
  await waitFor(() => member.page.evaluate(`Boolean([...document.querySelectorAll('.remote-team-board .task-card')]
    .find((item) => item.textContent.includes(${JSON.stringify(card.title)})))`),
    'host card on the member main board');
  await member.page.evaluate(`[...document.querySelectorAll('.remote-team-board .task-card')]
    .find((item) => item.textContent.includes(${JSON.stringify(card.title)})).click()`);
  await waitFor(() => member.page.evaluate('Boolean(document.querySelector(".remote-team-card-detail .team-card-draft textarea:not(:disabled)"))'),
    'shared card editor on member main board');
  await waitFor(() => owner.page.evaluate(`document.querySelector('.team-card-presence')?.textContent.includes('Member') &&
    document.querySelector('.team-card-presence')?.textContent.includes('Owner')`), 'two-client live presence', 15_000);

  await typeDraft(owner.page, 'Owner idea. ');
  await waitForText(member.page, 'Owner idea.');
  await typeDraft(member.page, 'Member addition. ');
  await waitForText(owner.page, 'Member addition.');
  const saved = await owner.page.evaluate(`window.studio.teamCardDraft({ workspaceId: ${JSON.stringify(hosted.workspaceId)},
    projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} })`);
  if (!draftText(saved).includes('Owner idea.') || !draftText(saved).includes('Member addition.')) {
    throw new Error('The two clients did not save both draft edits.');
  }
  const accepted = await owner.page.evaluate(`window.studio.snapshot(${JSON.stringify(project.id)})`);
  if (accepted.cards.find((item) => item.id === card.id)?.description !== card.description) {
    throw new Error('A shared draft changed the accepted card.');
  }

  if (!existsSync(join(owner.profile, 'team-secret-key.bin')) ||
    !existsSync(join(owner.profile, 'team-connections.bin'))) {
    throw new Error('The protected team key and connection were not both durable before owner exit.');
  }
  await stop(owner, crashOwner);
  owner = null;
  await waitFor(() => member.page.evaluate(`document.querySelector('.team-card-presence')?.textContent.includes('unterbrochen')`),
    'member disconnect after owner exit', 18_000);
  await typeDraft(member.page, 'Offline member idea. ');
  await waitFor(() => member.page.evaluate(`window.studio.pendingTeamCardDraftUpdates({ workspaceId: ${JSON.stringify(hosted.workspaceId)},
    projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} }).then((items) => items.length === 1)`),
    'encrypted pending member edit');
  owner = await launch('owner');
  await owner.page.evaluate(`(() => {
    const picker = document.querySelector('#project-select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(picker, ${JSON.stringify(project.id)});
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await navigateTeam(owner.page);
  await openDraft(owner.page, card.title);
  try { await waitForText(owner.page, 'Offline member idea.'); }
  catch (error) {
    const memberState = await member.page.evaluate(`(async () => ({
      status: document.querySelector('.team-card-draft')?.textContent.slice(0, 400),
      boardError: document.querySelector('.remote-team-board-error')?.textContent,
      boardCards: document.querySelectorAll('.remote-team-board .task-card').length,
      selected: document.querySelector('.remote-team-board .task-card[aria-pressed="true"]')?.textContent,
      pending: (await window.studio.pendingTeamCardDraftUpdates({ workspaceId: ${JSON.stringify(hosted.workspaceId)},
        projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} })).length
    }))()`);
    throw new Error(`${error.message}; member=${JSON.stringify(memberState)}`);
  }
  await waitFor(() => member.page.evaluate(`window.studio.pendingTeamCardDraftUpdates({ workspaceId: ${JSON.stringify(hosted.workspaceId)},
    projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} }).then((items) => items.length === 0)`),
    'outbox replay after coordinator restart', 25_000);
  const afterRestart = await owner.page.evaluate(`window.studio.teamCardDraft({ workspaceId: ${JSON.stringify(hosted.workspaceId)},
    projectId: ${JSON.stringify(project.id)}, cardId: ${JSON.stringify(card.id)} })`);
  if (afterRestart.revision !== saved.revision + 1 || !draftText(afterRestart).includes('Offline member idea.')) {
    throw new Error('The offline update was lost or duplicated after a real owner-process restart.');
  }
  process.stdout.write('TEAM_TWO_PROCESS_SMOKE_OK\n');
} catch (error) {
  process.stderr.write(`TEAM_TWO_PROCESS_SMOKE_FAILED: ${error.stack ?? error}\n`);
  process.exitCode = 1;
} finally {
  await stop(member);
  await stop(owner);
  for (const child of children) child.kill();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { rmSync(root, { recursive: true, force: true }); break; }
    catch (error) { if (attempt === 19) process.stderr.write(`Smoke cleanup delayed: ${error.message}\n`); else await delay(250); }
  }
}
