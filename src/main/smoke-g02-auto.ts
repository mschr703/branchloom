import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { ensureCardWorktree } from './git-worktree';
import { advanceAutomaticIntegrations, integrationQueue, integrationPolicy } from './integration-queue';
import { setProjectRunPause } from './project-pause';
import { StudioStore } from './store';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim();
}

function commit(cwd: string, file: string, content: string): string {
  writeFileSync(join(cwd, file), content);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic automatic integration']);
  return git(cwd, ['rev-parse', 'HEAD']);
}

/** Visible UI acceptance for the opt-in final fast-forward step; uses only synthetic local Git data. */
export async function runG02AutoSmoke(window: BrowserWindow, store: StudioStore, root: string): Promise<void> {
  const repo = join(root, 'g02-auto-repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  const targetHead = commit(repo, 'package.json', JSON.stringify({ name: 'g02-auto-smoke', version: '1.0.0',
    scripts: { verify: 'node -e "process.stdout.write(\'G02_AUTO_OK\\n\')"' } }));
  const project = store.createProject({ name: 'G02 Auto Smoke', path: repo });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Automatic login' });
  const tree = ensureCardWorktree(store, card.id);
  const session = store.createSession({ cardId: card.id, agentId: store.agents()[0]!.id, worktreePath: tree.path });
  const sourceHead = commit(tree.path, 'login.txt', 'synthetic login\n');
  store.finishSession(session.id, 'exited', 0);
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label, attempts = 240) => {
      for (let i = 0; i < attempts; i++) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('G02 auto UI timeout: ' + label + ' / ' + document.querySelector('.card-drawer')?.textContent?.slice(-700));
    };
    const panel = () => document.querySelector('.card-drawer [aria-label="Integrationswarteschlange"]');
    const button = (text) => [...(panel()?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(text));
    const click = async (text) => {
      const target = await wait(() => {
        const candidate = button(text);
        return candidate && !candidate.disabled && candidate.isConnected ? candidate : null;
      }, 'enabled ' + text);
      target.click();
    };
    let confirmations = 0;
    window.confirm = (message) => {
      if (message.includes('Die geprüften Commits')) throw new Error('G02 requested an individual merge confirmation.');
      confirmations++;
      return true;
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === 'G02 Auto Smoke auswählen'), 'project choice');
    choice.click();
    await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger')?.getAttribute('aria-label') === 'Projekt auswählen: G02 Auto Smoke', 'project selected');
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Board'), 'Board navigation');
    nav.click();
    const card = await wait(() => document.getElementById('board-card-' + ${JSON.stringify(card.id)}), 'card');
    card.click();
    await wait(() => panel() && !panel().textContent?.includes('Integrationsliste wird geladen'), 'queue panel');
    const toggle = panel().querySelector('.integration-policy input[type="checkbox"]');
    if (!(toggle instanceof HTMLInputElement) || toggle.checked || !toggle.disabled) throw new Error('Automatic integration did not start disabled.');
    await click('Diese Karte vormerken');
    await wait(() => panel()?.textContent?.includes('Wartet'), 'queued');
    await click('Git-Stand neu prüfen');
    await wait(() => panel()?.textContent?.includes('Geprüft'), 'prepared');
    const script = panel()?.querySelector('input[placeholder="test"]');
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!(script instanceof HTMLInputElement) || !setInput) throw new Error('Test script field missing.');
    setInput.call(script, 'verify');
    script.dispatchEvent(new Event('input', { bubbles: true }));
    await click('Testskript speichern');
    await wait(() => button('npm run verify prüfen') && !toggle.disabled, 'test script configured');
    toggle.click();
    await wait(async () => (await window.studio.integrationPolicy(${JSON.stringify(project.id)})).mode === 'automatic' && toggle.checked, 'automatic policy stored');
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    if ((await window.studio.integrationQueue(${JSON.stringify(project.id)}))[0]?.state !== 'ready') throw new Error('Automatic integration merged before review and test.');
    await wait(() => panel()?.textContent?.includes('Review this exact prepared Git diff'), 'missing evidence visible');
    toggle.click();
    await wait(async () => (await window.studio.integrationPolicy(${JSON.stringify(project.id)})).mode === 'manual' && !toggle.checked, 'automatic policy disabled');
    await click('Diff öffnen');
    await wait(() => document.querySelector('.review-diff')?.textContent?.includes('login.txt'), 'visible Git diff');
    await click('Diff geprüft bestätigen');
    await wait(async () => (await window.studio.integrationEvidence(${JSON.stringify(card.id)})).review?.current, 'review evidence');
    await click('npm run verify prüfen');
    await wait(async () => {
      const evidence = await window.studio.integrationEvidence(${JSON.stringify(card.id)});
      return evidence.test?.state === 'passed' && evidence.test.current && evidence.test.outputTail.includes('G02_AUTO_OK');
    }, 'passing test evidence', 300);
    if (confirmations < 3) throw new Error('G02 skipped a policy, diff, or npm test confirmation.');
    return true;
  })()`);

  // Enable the tested policy while paused, so no worker tick can race the F07 assertion.
  setProjectRunPause(store, { projectId: project.id, paused: true });
  await window.webContents.executeJavaScript(`(async () => {
    const toggle = document.querySelector('.card-drawer .integration-policy input[type="checkbox"]');
    if (!(toggle instanceof HTMLInputElement) || toggle.checked || toggle.disabled) throw new Error('G02 policy toggle unavailable after test.');
    toggle.click();
    for (let i = 0; i < 100; i++) {
      if ((await window.studio.integrationPolicy(${JSON.stringify(project.id)})).mode === 'automatic' && toggle.checked) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('G02 automatic policy did not persist under project pause.');
  })()`);
  if (advanceAutomaticIntegrations(store).length || git(repo, ['rev-parse', 'HEAD']) !== targetHead)
    throw new Error('G02 automatic integration ignored the project pause.');
  await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      if (document.querySelector('.card-drawer [aria-label="Integrationswarteschlange"]')?.textContent?.includes('Projekt ist sicher angehalten')) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('G02 pause reason was not visible in the queue.');
  })()`);
  setProjectRunPause(store, { projectId: project.id, paused: false });
  await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 300; i++) {
      const item = (await window.studio.integrationQueue(${JSON.stringify(project.id)}))[0];
      if (item?.state === 'integrated' && item.approvalMode === 'automatic'
        && document.querySelector('.card-drawer [aria-label="Integrationswarteschlange"]')?.textContent?.includes('automatisch')) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('G02 automatic integration did not become visible without an individual merge click.');
  })()`);
  if (git(repo, ['rev-parse', 'HEAD']) !== sourceHead || integrationQueue(store, project.id)[0]?.integratedHead !== sourceHead)
    throw new Error('G02 automatic integration did not advance the target to the reviewed source.');
  const reopened = new StudioStore(join(root, 'studio.sqlite'));
  try {
    if (integrationPolicy(reopened, project.id).mode !== 'automatic' || advanceAutomaticIntegrations(reopened).length
      || integrationQueue(reopened, project.id)[0]?.approvalMode !== 'automatic'
      || git(repo, ['rev-parse', 'HEAD']) !== sourceHead)
      throw new Error('G02 automatic integration receipt was not durable or was repeated after SQLite restart.');
  } finally { reopened.close(); }
}
