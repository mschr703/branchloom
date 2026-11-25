import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { StudioStore } from './store';
import { createWhiteboardEdge, createWhiteboardNode, whiteboardSnapshot } from './whiteboard';

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
  const capturePath = process.env.BRANCHLOOM_WHITEBOARD_CAPTURE;
  if (capturePath) {
    const service = createWhiteboardNode(store, { projectId: project.id, title: 'Preview service', description: 'Synthetic preview data', x: 350, y: 32 });
    const checks = createWhiteboardNode(store, { projectId: project.id, title: 'UI checks', description: 'Keyboard and responsive layout', x: 350, y: 245 });
    createWhiteboardEdge(store, { projectId: project.id, sourceId: saved.id, targetId: service.id, label: 'renders' });
    createWhiteboardEdge(store, { projectId: project.id, sourceId: service.id, targetId: checks.id, label: 'verify' });
  }
  const before = whiteboardSnapshot(store, project.id);
  if (!before.nodes.some((node) => node.id === saved.id) || before.nodes.length !== (capturePath ? 3 : 1)) throw new Error('Saved board fixture is missing.');

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
    if (![...document.querySelectorAll('.wb-heading-actions button')].some((button) => button.textContent?.includes('Bereich wählen'))) throw new Error('Area selection control is missing.');
    return true;
  })()`);
  if (capturePath) {
    await window.webContents.executeJavaScript(`(async () => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (document.querySelectorAll('.wb-node').length === 3 && !document.querySelector('.wb-loading')) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Synthetic Whiteboard did not settle for screenshot.');
    })()`);
    window.showInactive();
    try {
      await new Promise((resolve) => setTimeout(resolve, 750));
      writeFileSync(capturePath, (await window.webContents.capturePage()).toPNG());
    } finally { window.hide(); }
    const captured = whiteboardSnapshot(store, project.id);
    if (captured.nodes.length !== before.nodes.length || captured.edges.length !== before.edges.length) throw new Error('Synthetic capture changed the Whiteboard.');
    return;
  }
  const after = whiteboardSnapshot(store, project.id);
  if (after.nodes.length !== before.nodes.length || !after.nodes.some((node) => node.id === saved.id) || after.edges.length !== before.edges.length || store.snapshot(project.id).sessions.length)
    throw new Error('Inspecting tracked sources changed saved architecture or started an agent.');
  await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll('.wb-heading-actions button, .wb-inspector button')].find((item) => item.textContent?.includes(label));
    findButton('Bereich wählen')?.click();
    for (let attempt = 0; attempt < 100 && (!document.querySelector('.wb-discussion') || !findButton('Auswahl beenden')); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (!document.querySelector('.wb-discussion') || !findButton('Auswahl beenden')) throw new Error('Area discussion is not reachable.');
    return true;
  })()`);
  const rectangle = await window.webContents.executeJavaScript(`(() => {
    const node = document.querySelector('.wb-node');
    const pane = document.querySelector('.react-flow__pane');
    if (!node || !pane) throw new Error('Selection fixture is missing.');
    const box = node.getBoundingClientRect();
    const canvas = pane.getBoundingClientRect();
    return { x1: Math.max(canvas.left + 8, box.left - 22), y1: Math.max(canvas.top + 8, box.top - 22),
      x2: Math.min(canvas.right - 8, box.right + 22), y2: Math.min(canvas.bottom - 8, box.bottom + 22) };
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: Math.round(rectangle.x1), y: Math.round(rectangle.y1), clickCount: 1 });
  for (let step = 1; step <= 5; step++) window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(rectangle.x1 + (rectangle.x2 - rectangle.x1) * step / 5), y: Math.round(rectangle.y1 + (rectangle.y2 - rectangle.y1) * step / 5), movementX: 4, movementY: 4 });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: Math.round(rectangle.x2), y: Math.round(rectangle.y2), clickCount: 1 });
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (/Ausgewählte Quellen · [1-9]/.test(document.querySelector('.wb-discussion h4')?.textContent ?? '')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Drag rectangle did not select a saved box.');
  })()`);
  await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.wb-area-list summary')?.click();
    const box = document.querySelector('.wb-area-list input[type=checkbox]');
    if (!box?.checked) throw new Error('Keyboard selection list does not reflect the drag selection.');
    box.click();
    for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-discussion h4')?.textContent?.endsWith('0'); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (!document.querySelector('.wb-discussion h4')?.textContent?.endsWith('0')) throw new Error('Keyboard list did not remove selection.');
    document.querySelector('.wb-area-list input[type=checkbox]')?.click();
    for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-discussion h4')?.textContent?.endsWith('1'); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (!document.querySelector('.wb-discussion h4')?.textContent?.endsWith('1')) throw new Error('Keyboard list did not restore selection.');
    return true;
  })()`);
  await window.webContents.executeJavaScript(`(async () => {
    const findButton = (label) => [...document.querySelectorAll('.wb-heading-actions button, .wb-inspector button')].find((item) => item.textContent?.includes(label));
    findButton('Box entwerfen')?.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (document.querySelector('.wb-unsaved-node') && findButton('Box übernehmen')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Unsaved node draft is not visible.');
  })()`);
  if (whiteboardSnapshot(store, project.id).nodes.length !== before.nodes.length) throw new Error('A node draft wrote before explicit acceptance.');
  await window.webContents.executeJavaScript(`(async () => {
    const button = [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Box übernehmen'));
    button?.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!document.querySelector('.wb-unsaved-node') && [...document.querySelectorAll('.wb-node')].some((node) => node.textContent?.includes('Neue Box'))) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Accepted node did not appear on the canvas.');
  })()`);
  const accepted = whiteboardSnapshot(store, project.id);
  if (accepted.nodes.length !== before.nodes.length + 1) throw new Error('Accepted node was not persisted.');
  const newNode = accepted.nodes.find((node) => !before.nodes.some((earlier) => earlier.id === node.id));
  if (!newNode) throw new Error('Accepted node cannot be identified.');
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-connect-from-node select'); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const select = document.querySelector('.wb-connect-from-node select');
    if (!select) throw new Error('Keyboard connection control is missing.');
    if (![...select.options].some((option) => option.value === ${JSON.stringify(saved.id)})) throw new Error('Original node is not a connection target.');
    select.focus();
    return true;
  })()`);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const button = [...document.querySelectorAll('.wb-connect-from-node button')].find((item) => item.textContent?.includes('Verbindung entwerfen'));
      if (button && !button.disabled) { button.click(); break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (let attempt = 0; attempt < 100; attempt++) {
      if (document.querySelector('.wb-unsaved-edge') && [...document.querySelectorAll('.wb-inspector button')].some((item) => item.textContent?.includes('Verbindung übernehmen'))) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Connection draft did not appear: ' + document.querySelector('.wb-inspector')?.textContent?.slice(0, 420)
      + ' / target=' + document.querySelector('.wb-connect-from-node select')?.value + ' / disabled=' + document.querySelector('.wb-connect-from-node button')?.disabled);
  })()`);
  if (whiteboardSnapshot(store, project.id).edges.length !== before.edges.length) throw new Error('A connection draft wrote before explicit acceptance.');
  await window.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Verbindung übernehmen'))?.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!document.querySelector('.wb-unsaved-edge') && document.querySelectorAll('.wb-edge').length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Accepted connection did not appear.');
  })()`);
  if (whiteboardSnapshot(store, project.id).edges.length !== before.edges.length + 1) throw new Error('Accepted connection was not persisted.');
}
