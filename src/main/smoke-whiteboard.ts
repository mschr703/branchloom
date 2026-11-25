import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { StudioStore } from './store';
import { createWhiteboardNode, whiteboardSnapshot } from './whiteboard';

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], { windowsHide: true });
}

/** A saved board can inspect current tracked paths without modifying its layout. */
export async function runWhiteboardVisibleSmoke(window: BrowserWindow, store: StudioStore, root: string): Promise<void> {
  const repo = join(root, 'whiteboard-repo');
  mkdirSync(join(repo, 'src', 'ui'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# Synthetic project\n');
  writeFileSync(join(repo, 'src', 'ui', 'Button.tsx'), 'export function Button() { return null; }\n');
  git(repo, ['init', '-q']);
  git(repo, ['add', '--', 'README.md', 'src/ui/Button.tsx']);
  git(repo, ['-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic source structure']);
  const project = store.createProject({ name: 'Whiteboard Smoke', path: repo });
  const saved = createWhiteboardNode(store, { projectId: project.id, title: 'My saved architecture', x: 24, y: 32 });
  const before = whiteboardSnapshot(store, project.id);
  if (before.nodes.length !== 1 || before.nodes[0]?.id !== saved.id) throw new Error('Saved board fixture is missing.');

  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 160; attempt++) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Whiteboard UI timeout: ' + label + ' / ' + document.body.textContent?.slice(-500));
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project button')]
      .find((item) => item.textContent?.trim() === 'Whiteboard Smoke'), 'project choice');
    choice.click();
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Whiteboard'), 'whiteboard navigation');
    nav.click();
    await wait(() => document.querySelector('.wb-node')?.textContent?.includes('My saved architecture'), 'saved board node');
    const open = await wait(() => [...document.querySelectorAll('.wb-heading-actions button')]
      .find((item) => item.textContent?.includes('Git-Struktur ansehen')), 'source mode control');
    open.click();
    await wait(() => document.querySelector('.wb-proposal-node') && document.querySelector('.wb-source-list button'), 'tracked source map');
    if (document.querySelector('.wb-node')?.textContent?.includes('My saved architecture')) throw new Error('Saved board leaked into the source preview.');
    const source = [...document.querySelectorAll('.wb-source-list button')].find((item) => item.textContent?.includes('src'));
    if (!source) throw new Error('Tracked path is absent from the source list.');
    source.focus();
    if (document.activeElement !== source) throw new Error('Source list is not keyboard focusable.');
    source.click();
    await wait(() => document.querySelector('.wb-source-detail')?.textContent?.includes('src'), 'source evidence');
    const back = [...document.querySelectorAll('.wb-heading-actions button')].find((item) => item.textContent?.includes('Arbeitsfläche ansehen'));
    back?.click();
    await wait(() => document.querySelector('.wb-node')?.textContent?.includes('My saved architecture'), 'return to saved board');
    if (document.querySelector('.wb-proposal-node')) throw new Error('Source preview remained in the saved board.');
    return true;
  })()`);
  const after = whiteboardSnapshot(store, project.id);
  if (after.nodes.length !== 1 || after.nodes[0]?.id !== saved.id || after.edges.length || store.snapshot(project.id).sessions.length)
    throw new Error('Inspecting tracked sources changed saved architecture or started an agent.');
}
