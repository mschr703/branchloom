import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { devEnvironmentProfile, type DevEnvironmentRunner } from './dev-environment';
import { ensureCardWorktree } from './git-worktree';
import type { StudioStore } from './store';

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, stdio: 'pipe' });
}

function commit(cwd: string, file: string, content: string): void {
  writeFileSync(join(cwd, file), content);
  git(cwd, ['add', '--', file]);
  git(cwd, ['-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid',
    'commit', '-qm', 'Synthetic F01 variant']);
}

/** UI acceptance for two separate card servers; all files and processes are synthetic. */
export async function runF01VisibleSmoke(window: BrowserWindow, store: StudioStore,
  runner: DevEnvironmentRunner, root: string): Promise<void> {
  const repo = join(root, 'f01-repo');
  mkdirSync(repo);
  git(repo, ['init', '-q']);
  writeFileSync(join(repo, 'server.cjs'), [
    "const http = require('node:http');",
    "const fs = require('node:fs');",
    "const variant = fs.readFileSync('variant.txt', 'utf8').trim();",
    "const port = Number(process.argv[process.argv.indexOf('--port') + 1]);",
    "http.createServer((_request, response) => response.end('READY:' + variant)).listen(port, '127.0.0.1', () => console.log('F01_SERVER:' + variant));",
  ].join('\n'));
  commit(repo, 'variant.txt', 'base\n');
  git(repo, ['add', 'server.cjs']);
  git(repo, ['-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid',
    'commit', '-qm', 'Synthetic F01 server']);
  const project = store.createProject({ name: 'F01 Preview Smoke', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const first = store.createCard({ projectId: project.id, columnId, title: 'F01 Variant A' });
  const second = store.createCard({ projectId: project.id, columnId, title: 'F01 Variant B' });
  commit(ensureCardWorktree(store, first.id).path, 'variant.txt', 'A\n');
  commit(ensureCardWorktree(store, second.id).path, 'variant.txt', 'B\n');

  try {
    await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
    const runs = await window.webContents.executeJavaScript(`(async () => {
      const wait = async (condition, label, attempts = 160) => {
        for (let i = 0; i < attempts; i++) {
          const value = await condition();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('F01 UI timeout: ' + label + ' / ' + document.querySelector('.card-drawer .card-dev-env')?.textContent?.slice(-450));
      };
      const panel = () => document.querySelector('.card-drawer .card-dev-env');
      const button = (label) => [...(panel()?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(label));
      const click = async (label) => {
        const target = await wait(() => button(label), label);
        if (!(target instanceof HTMLButtonElement) || target.disabled) throw new Error('F01 action unavailable: ' + label);
        target.click();
      };
      const setField = (field, value) => {
        const setter = Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('F01 field setter is missing.');
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const select = await wait(() => document.querySelector('#project-select'), 'project selector');
      const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      if (!(select instanceof HTMLSelectElement) || !selectSetter) throw new Error('F01 project selector missing.');
      selectSetter.call(select, ${JSON.stringify(project.id)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => select.value === ${JSON.stringify(project.id)}, 'selected project');
      const open = async (title) => {
        const board = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
          .find((item) => item.querySelector('.nav-label')?.textContent === 'Board'), 'Board navigation');
        board.click();
        const card = await wait(() => [...document.querySelectorAll('.task-card')].find((item) => item.textContent?.includes(title)), title);
        card.click();
        return await wait(panel, title + ' preview panel');
      };
      const close = async () => {
        document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
        await wait(() => !document.querySelector('.card-drawer'), 'closed card');
      };
      const launch = async (cardId, variant) => {
        await click('Für diese Karte starten');
        const run = await wait(async () => {
          const current = await window.studio.cardDevEnvironment(cardId);
          return current?.state === 'ready' ? current : null;
        }, variant + ' ready', 220);
        await wait(() => panel()?.querySelector('.card-dev-env-state strong')?.textContent === 'Bereit', variant + ' visible readiness', 100);
        await wait(() => panel()?.querySelector('.card-dev-env-state details')?.textContent?.includes('F01_SERVER:' + variant), variant + ' process output', 100);
        if (!panel()?.textContent?.includes(run.url) || !panel()?.textContent?.includes(run.branch) || !panel()?.textContent?.includes(run.worktreePath))
          throw new Error('F01 card does not show its address, branch and worktree.');
        await click('Vorschau öffnen');
        await wait(async () => (await window.studio.browserState()).url === run.url, variant + ' browser tab');
        await wait(() => document.querySelector('.browser-page'), variant + ' visible browser');
        return run;
      };
      await open('F01 Variant A');
      const form = await wait(() => panel()?.querySelector('form.card-dev-env-form'), 'first profile form');
      const inputs = form.querySelectorAll('input');
      const args = form.querySelector('textarea');
      if (inputs.length < 3 || !(args instanceof HTMLTextAreaElement)) throw new Error('F01 setup fields missing.');
      setField(inputs[0], 'node');
      setField(args, 'server.cjs\\n--host\\n127.0.0.1\\n--port\\n{port}');
      setField(inputs[2], 'READY:');
      await click('Projektprofil speichern');
      await wait(() => button('Für diese Karte starten') && !panel()?.querySelector('form.card-dev-env-form'), 'saved profile');
      const firstRun = await launch(${JSON.stringify(first.id)}, 'A');
      await close();
      await open('F01 Variant B');
      if (panel()?.querySelector('form.card-dev-env-form')) throw new Error('F01 second card did not reuse the saved profile.');
      const secondRun = await launch(${JSON.stringify(second.id)}, 'B');
      return { firstRun, secondRun };
    })()`);
    const firstRun = runner.verifyCurrentPreview(first.id, runs.firstRun.id);
    const secondRun = runner.verifyCurrentPreview(second.id, runs.secondRun.id);
    if (firstRun.port === secondRun.port || firstRun.url === secondRun.url || firstRun.branch === secondRun.branch
      || (await (await fetch(firstRun.url)).text()).trim() !== 'READY:A'
      || (await (await fetch(secondRun.url)).text()).trim() !== 'READY:B')
      throw new Error('F01 two-card previews are not distinct live worktree versions.');

    await window.webContents.executeJavaScript(`(async () => {
      const wait = async (condition, label, attempts = 160) => {
        for (let i = 0; i < attempts; i++) {
          const value = await condition();
          if (value) return value;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('F01 UI timeout: ' + label);
      };
      const panel = () => document.querySelector('.card-drawer .card-dev-env');
      const open = async (title) => {
        document.querySelector('.card-drawer button[aria-label="Karte schließen"]')?.click();
        await wait(() => !document.querySelector('.card-drawer'), 'closed card');
        const board = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
          .find((item) => item.querySelector('.nav-label')?.textContent === 'Board'), 'Board navigation');
        board.click();
        const card = await wait(() => [...document.querySelectorAll('.task-card')].find((item) => item.textContent?.includes(title)), title);
        card.click();
        await wait(panel, 'preview panel');
      };
      await open('F01 Variant A');
      const stop = await wait(() => [...(panel()?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes('Stoppen')), 'first stop');
      stop.click();
      await wait(() => panel()?.querySelector('.card-dev-env-state strong')?.textContent === 'Gestoppt', 'first stopped');
      if ((await window.studio.cardDevEnvironment(${JSON.stringify(second.id)}))?.state !== 'ready') throw new Error('F01 stopping A changed B.');
      return true;
    })()`);
    if ((await (await fetch(secondRun.url)).text()).trim() !== 'READY:B')
      throw new Error('F01 stopping A also stopped B.');
    await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
    const persisted = devEnvironmentProfile(store, project.id);
    if (!persisted || runner.card(first.id)?.state !== 'stopped' || runner.card(second.id)?.state !== 'ready')
      throw new Error('F01 state or project profile did not survive renderer reload.');
    if ((await (await fetch(secondRun.url)).text()).trim() !== 'READY:B')
      throw new Error('F01 live second server did not survive renderer reload.');
    runner.stop(secondRun.id);
  } finally {
    for (const cardId of [first.id, second.id]) {
      const run = runner.card(cardId);
      if (run?.managed && (run.state === 'ready' || run.state === 'starting')) {
        try { runner.stop(run.id); } catch { /* App shutdown retains uncertain runs for inspection. */ }
      }
    }
  }
}
