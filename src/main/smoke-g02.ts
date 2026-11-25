import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { ensureCardWorktree } from './git-worktree';
import { integrationQueue } from './integration-queue';
import type { StudioStore } from './store';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function commit(cwd: string, file: string, content: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic G02 change']);
  return git(cwd, ['rev-parse', 'HEAD']);
}

/** A separate hidden-window smoke avoids making the broad app smoke a Git integration test. */
export async function runG02VisibleSmoke(window: BrowserWindow, store: StudioStore, root: string): Promise<void> {
  const repo = join(root, 'g02-repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  commit(repo, 'package.json', JSON.stringify({ name: 'g02-smoke', version: '1.0.0',
    scripts: { verify: 'node -e "process.stdout.write(\'G02_TEST_OK\\n\')"' } }));
  const project = store.createProject({ name: 'G02 Integration Smoke', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const first = store.createCard({ projectId: project.id, columnId, title: 'G02 Login' });
  const second = store.createCard({ projectId: project.id, columnId, title: 'G02 Navigation' });
  const agentId = store.agents()[0]!.id;
  const firstTree = ensureCardWorktree(store, first.id);
  const secondTree = ensureCardWorktree(store, second.id);
  const firstSession = store.createSession({ cardId: first.id, agentId, worktreePath: firstTree.path });
  const firstHead = commit(firstTree.path, 'login.txt', 'synthetic login\n');
  store.finishSession(firstSession.id, 'exited', 0);
  const secondSession = store.createSession({ cardId: second.id, agentId, worktreePath: secondTree.path });
  const secondHead = commit(secondTree.path, 'navigation.txt', 'synthetic navigation\n');
  store.finishSession(secondSession.id, 'exited', 0);

  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (condition, label, attempts = 120) => {
      for (let i = 0; i < attempts; i++) {
        const value = await condition();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('G02 UI timeout: ' + label + ' / alert=' + document.querySelector('.card-drawer [role="alert"]')?.textContent?.slice(0, 300)
        + ' / queue=' + document.querySelector('.card-drawer [aria-label="Integrationswarteschlange"]')?.textContent?.slice(-1600));
    };
    const currentPanel = () => document.querySelector('.card-drawer [aria-label="Integrationswarteschlange"]');
    const button = (_panel, label) => [...(currentPanel()?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(label));
    const click = async (panel, label) => {
      const target = await wait(() => button(panel, label), label);
      if (target.disabled || !target.isConnected) throw new Error('G02 action unavailable: ' + label + ' / ' + currentPanel()?.textContent?.slice(-500));
      target.click();
    };
    window.confirm = () => true;
    await wait(() => document.querySelector('#project-select'), 'project selector');
    const select = document.querySelector('#project-select');
    const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!(select instanceof HTMLSelectElement) || !setSelect) throw new Error('G02 project selector is unavailable.');
    setSelect.call(select, ${JSON.stringify(project.id)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => select.value === ${JSON.stringify(project.id)}, 'selected project');
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.querySelector('.nav-label')?.textContent === 'Board'), 'Board navigation');
    nav.click();
    const openCard = async (title) => {
      const card = await wait(() => [...document.querySelectorAll('.task-card')].find((item) => item.textContent?.includes(title)), title + ' card');
      card.click();
      return await wait(() => document.querySelector('.card-drawer [aria-label="Integrationswarteschlange"]'), title + ' integration panel');
    };
    let panel = await openCard('G02 Login');
    await wait(() => currentPanel() && !currentPanel().textContent?.includes('Integrationsliste wird geladen'), 'queue loaded');
    await click(panel, 'Diese Karte vormerken');
    await wait(() => currentPanel()?.textContent?.includes('Wartet'), 'queued card');
    await click(panel, 'Git-Stand neu prüfen');
    await wait(() => currentPanel()?.textContent?.includes('Geprüft · Freigabe nötig'), 'prepared card');
    const approve = button(panel, 'Geprüft übernehmen');
    if (!(approve instanceof HTMLButtonElement) || !approve.disabled) throw new Error('G02 merge is available before review and test.');
    const script = currentPanel()?.querySelector('input[placeholder="test"]');
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!(script instanceof HTMLInputElement) || !setInput) throw new Error('G02 project script setting is missing.');
    setInput.call(script, 'verify');
    script.dispatchEvent(new Event('input', { bubbles: true }));
    await click(panel, 'Testskript speichern');
    await wait(() => button(panel, 'npm run verify prüfen'), 'configured test button');
    await click(panel, 'Diff öffnen');
    await wait(() => document.querySelector('.review-diff')?.textContent?.includes('login.txt'), 'visible source diff');
    let confirmationCalls = 0;
    window.confirm = () => { confirmationCalls++; return false; };
    await click(panel, 'Diff geprüft bestätigen');
    if (confirmationCalls !== 1 || (await window.studio.integrationEvidence(${JSON.stringify(first.id)})).review) throw new Error('G02 saved a declined diff review or skipped its confirmation: ' + confirmationCalls);
    window.confirm = () => { confirmationCalls++; return true; };
    await click(panel, 'Diff geprüft bestätigen');
    await wait(async () => (await window.studio.integrationEvidence(${JSON.stringify(first.id)})).review?.current && currentPanel()?.textContent?.includes('Diff-Prüfung: aktuell'), 'saved diff review');
    if (confirmationCalls !== 2 || !button(panel, 'Geprüft übernehmen')?.disabled) throw new Error('G02 review confirmation or pre-test merge gate failed: ' + confirmationCalls);
    await click(panel, 'npm run verify prüfen');
    await wait(() => currentPanel()?.textContent?.includes('Test: Bestanden') && !button(panel, 'Geprüft übernehmen')?.disabled, 'passing test evidence', 1200);
    const result = await window.studio.integrationEvidence(${JSON.stringify(first.id)});
    if (!result.review?.current || result.test?.state !== 'passed' || !result.test.current || !result.test.outputTail.includes('G02_TEST_OK')) throw new Error('G02 test/review evidence was not stored.');
    window.confirm = () => false;
    await click(panel, 'Geprüft übernehmen');
    if ((await window.studio.integrationQueue(${JSON.stringify(project.id)})).find((item) => item.cardId === ${JSON.stringify(first.id)})?.state !== 'ready') throw new Error('G02 merged after declined confirmation.');
    window.confirm = () => true;
    await click(panel, 'Geprüft übernehmen');
    const merged = await wait(async () => {
      const row = (await window.studio.integrationQueue(${JSON.stringify(project.id)})).find((item) => item.cardId === ${JSON.stringify(first.id)});
      return row?.state === 'integrated' ? row : null;
    }, 'manual Git merge result');
    if (merged.integratedHead !== ${JSON.stringify(firstHead)}) throw new Error('G02 merge committed a different source head.');
    panel = await wait(() => {
      const live = document.querySelector('.card-drawer [aria-label="Integrationswarteschlange"]');
      return live?.textContent?.includes('Übernommen') ? live : null;
    }, 'visible manual merge result');
    document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
    await wait(() => !document.querySelector('.card-drawer'), 'closed first card');
    panel = await openCard('G02 Navigation');
    await wait(() => currentPanel() && !currentPanel().textContent?.includes('Integrationsliste wird geladen'), 'second queue loaded');
    await click(panel, 'Diese Karte vormerken');
    await wait(() => currentPanel()?.textContent?.includes('Wartet'), 'second queued card');
    await click(panel, 'Git-Stand neu prüfen');
    await wait(() => currentPanel()?.textContent?.includes('Blockiert'), 'diverged branch blocked');
    if (button(panel, 'Geprüft übernehmen')) throw new Error('G02 offered merge for divergent second branch.');
    const resultsToggle = await wait(() => currentPanel()?.querySelector('.integration-results > summary'), 'result folder toggle');
    resultsToggle.click();
    const results = await wait(() => {
      const element = currentPanel()?.querySelector('.integration-results-body');
      return element?.textContent?.includes('G02 Login') && element.textContent.includes('G02 Navigation')
        && element.textContent.includes('Commit im aktuellen Ziel nachweisbar') ? element : null;
    }, 'visible merged and blocked result folder');
    if (!results.textContent.includes('Review belegt') || !results.textContent.includes('Test bestanden (verify)'))
      throw new Error('G02 result folder omitted matching review or test evidence.');
    return true;
  })()`);

  const rows = integrationQueue(store, project.id);
  if (rows.find((item) => item.cardId === first.id)?.state !== 'integrated'
    || rows.find((item) => item.cardId === second.id)?.state !== 'blocked'
    || git(repo, ['rev-parse', 'HEAD']) !== firstHead
    || git(secondTree.path, ['rev-parse', 'HEAD']) !== secondHead
    || readFileSync(join(repo, 'login.txt'), 'utf8').replace(/\r\n/g, '\n') !== 'synthetic login\n'
    || readFileSync(join(secondTree.path, 'navigation.txt'), 'utf8').replace(/\r\n/g, '\n') !== 'synthetic navigation\n') {
    throw new Error('G02 Git outcome or untouched second worktree does not match the visible queue.');
  }
}
