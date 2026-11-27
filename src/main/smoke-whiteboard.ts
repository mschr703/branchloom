import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { StudioStore } from './store';
import { createWhiteboardEdge, createWhiteboardNode, whiteboardSnapshot } from './whiteboard';
import { createWhiteboardFreeLine, whiteboardFreeLines } from './whiteboard-lines';

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
  const libraryCapturePath = process.env.BRANCHLOOM_WHITEBOARD_LIBRARY_CAPTURE;
  const capturePath = libraryCapturePath ?? process.env.BRANCHLOOM_WHITEBOARD_CAPTURE;
  const projectName = capturePath ? 'Atlas map' : 'Whiteboard Smoke';
  const project = store.createProject({ name: projectName, path: repo });
  const saved = createWhiteboardNode(store, { projectId: project.id, title: 'My saved architecture', x: 24, y: 32 });
  if (capturePath) {
    const service = createWhiteboardNode(store, { projectId: project.id, title: 'Preview service', description: 'Synthetic preview data', x: 350, y: 32, shape: 'step' });
    const checks = createWhiteboardNode(store, { projectId: project.id, title: 'UI checks', description: 'Keyboard and responsive layout', x: 350, y: 245, shape: 'decision' });
    createWhiteboardEdge(store, { projectId: project.id, sourceId: saved.id, targetId: service.id, label: 'renders' });
    createWhiteboardEdge(store, { projectId: project.id, sourceId: service.id, targetId: checks.id, label: 'verify', lineStyle: 'dashed', endMarker: 'arrow' });
    if (libraryCapturePath) {
      createWhiteboardNode(store, { projectId: project.id, title: 'Start / Finish', x: 24, y: 245, shape: 'terminator' });
      createWhiteboardNode(store, { projectId: project.id, title: 'Design brief', x: 680, y: 32, shape: 'document' });
      createWhiteboardNode(store, { projectId: project.id, title: 'Input data', x: 680, y: 245, shape: 'data' });
      createWhiteboardFreeLine(store, { projectId: project.id, x1: 610, y1: 425, x2: 840, y2: 425, label: 'handoff', endMarker: 'arrow' });
    }
  }
  const before = whiteboardSnapshot(store, project.id);
  if (!before.nodes.some((node) => node.id === saved.id) || before.nodes.length !== (libraryCapturePath ? 6 : capturePath ? 3 : 1)) throw new Error('Saved board fixture is missing.');

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
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === ${JSON.stringify(`${projectName} auswählen`)}), 'project choice');
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
        if (document.querySelectorAll('.wb-node').length === ${libraryCapturePath ? 6 : 3} && !document.querySelector('.wb-loading')) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Synthetic Whiteboard did not settle for screenshot.');
    })()`);
    if (libraryCapturePath) {
      window.setSize(1440, 900);
    }
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
    const findButton = (label) => [...document.querySelectorAll('.wb-heading-actions button, .wb-shape-rail button, .wb-inspector button')].find((item) => item.textContent?.includes(label));
    findButton('Bereich wählen')?.click();
    for (let attempt = 0; attempt < 100 && (!document.querySelector('.wb-discussion') || !findButton('Auswahl beenden')); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    if (!document.querySelector('.wb-discussion') || !findButton('Auswahl beenden')) throw new Error('Area discussion is not reachable.');
    return true;
  })()`);
  const rectangle = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.react-flow__controls-fitview')?.click();
    const started = Date.now();
    let previous = '';
    let stableSince = started;
    for (let attempt = 0; attempt < 140; attempt++) {
      const node = document.querySelector('.react-flow__node[data-id=${JSON.stringify(saved.id)}]');
      const pane = document.querySelector('.react-flow__pane');
      if (!node || !pane) throw new Error('Selection fixture is missing.');
      const box = node.getBoundingClientRect();
      const canvas = pane.getBoundingClientRect();
      // The inspector changes the Flow pane width after returning from the
      // repository view. A stable node at the pane edge may still jump when
      // Flow's deferred fitView runs, so wait for the single fixture node to
      // settle near the center before using screen coordinates for the drag.
      const centered = Math.abs(box.left + box.width / 2 - (canvas.left + canvas.width / 2)) < 32
        && Math.abs(box.top + box.height / 2 - (canvas.top + canvas.height / 2)) < 32;
      if (!centered && attempt > 0 && attempt % 25 === 0) document.querySelector('.react-flow__controls-fitview')?.click();
      const rect = { x1: Math.round(Math.max(canvas.left + 8, box.left - 24)), y1: Math.round(Math.max(canvas.top + 8, box.top - 24)),
        x2: Math.round(Math.min(canvas.right - 8, box.right + 24)), y2: Math.round(Math.min(canvas.bottom - 8, box.bottom + 24)) };
      const valid = centered && rect.x1 < box.left - 2 && rect.y1 < box.top - 2 && rect.x2 > box.right + 2 && rect.y2 > box.bottom + 2
        && rect.x1 < rect.x2 && rect.y1 < rect.y2;
      const key = JSON.stringify({ rect, viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') });
      if (key !== previous || !valid) stableSince = Date.now();
      if (valid && Date.now() - started >= 1_200 && Date.now() - stableSince >= 700) return { ...rect, box: { x: box.x, y: box.y, width: box.width, height: box.height },
        pane: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height } };
      previous = key;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Saved box never settled inside the visible selection pane.');
  })()`);
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: rectangle.x1, y: rectangle.y1, clickCount: 1 });
  await pause(70);
  let previousX = rectangle.x1;
  let previousY = rectangle.y1;
  for (let step = 1; step <= 8; step++) {
    const x = Math.round(rectangle.x1 + (rectangle.x2 - rectangle.x1) * step / 8);
    const y = Math.round(rectangle.y1 + (rectangle.y2 - rectangle.y1) * step / 8);
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y, movementX: x - previousX, movementY: y - previousY });
    previousX = x; previousY = y;
    await pause(40);
  }
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: rectangle.x2, y: rectangle.y2, clickCount: 1 });
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (/Ausgewählte Quellen · [1-9]/.test(document.querySelector('.wb-discussion h4')?.textContent ?? '')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const node = document.querySelector('.react-flow__node[data-id=${JSON.stringify(saved.id)}]')?.getBoundingClientRect();
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect();
    throw new Error('Drag rectangle did not select a saved box: ' + JSON.stringify({ requested: ${JSON.stringify(rectangle)},
      currentNode: node && { x: node.x, y: node.y, width: node.width, height: node.height },
      currentPane: pane && { x: pane.x, y: pane.y, width: pane.width, height: pane.height },
      hit: document.elementFromPoint(${rectangle.x1}, ${rectangle.y1})?.className?.baseVal ?? document.elementFromPoint(${rectangle.x1}, ${rectangle.y1})?.className,
      selection: document.querySelector('.react-flow__selection')?.getBoundingClientRect().toJSON(),
      count: document.querySelector('.wb-discussion h4')?.textContent, viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style'),
      size: [innerWidth, innerHeight] }));
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
    const findButton = (label) => [...document.querySelectorAll('.wb-heading-actions button, .wb-shape-rail button, .wb-inspector button')].find((item) => item.textContent?.includes(label));
    findButton('Auswahl beenden')?.click();
    for (let attempt = 0; attempt < 100 && !findButton('Entscheidung'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    findButton('Entscheidung')?.click();
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
      if (!document.querySelector('.wb-unsaved-node') && [...document.querySelectorAll('.wb-node')].some((node) => node.textContent?.includes('Neue Entscheidung'))) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Accepted node did not appear on the canvas.');
  })()`);
  const accepted = whiteboardSnapshot(store, project.id);
  if (accepted.nodes.length !== before.nodes.length + 1) throw new Error('Accepted node was not persisted.');
  const newNode = accepted.nodes.find((node) => !before.nodes.some((earlier) => earlier.id === node.id));
  if (!newNode) throw new Error('Accepted node cannot be identified.');
  if (newNode.shape !== 'decision') throw new Error('The chosen node shape was not persisted.');
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
    const group = (name) => document.querySelector('.wb-inspector [role="group"][aria-label="' + name + '"]');
    [...group('Linienstil').querySelectorAll('button')].find((item) => item.textContent?.includes('Gestrichelt'))?.click();
    [...group('Pfeilende').querySelectorAll('button')].find((item) => item.textContent?.includes('Mit Pfeil'))?.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      const path = document.querySelector('.wb-unsaved-edge .react-flow__edge-path');
      if (/^6[, ]+4$/.test(path?.style.strokeDasharray ?? '') && path?.getAttribute('marker-end')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const draftPath = document.querySelector('.wb-unsaved-edge .react-flow__edge-path');
    if (!/^6[, ]+4$/.test(draftPath?.style.strokeDasharray ?? '') || !draftPath?.getAttribute('marker-end')) throw new Error('Dashed arrow draft is not visible: ' + draftPath?.outerHTML);
    const segment = draftPath?.getAttribute('d') ?? '';
    if (!/^M[^MLCQZ]+L[^MLCQZ]+$/i.test(segment)) throw new Error('Whiteboard connection should render as a straight segment: ' + segment);
    [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Verbindung übernehmen'))?.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      if (!document.querySelector('.wb-unsaved-edge') && document.querySelectorAll('.wb-edge').length > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Accepted connection did not appear.');
  })()`);
  const styled = whiteboardSnapshot(store, project.id);
  if (styled.edges.length !== before.edges.length + 1 || styled.edges.find((item) => item.sourceId === newNode.id)?.lineStyle !== 'dashed'
    || styled.edges.find((item) => item.sourceId === newNode.id)?.endMarker !== 'arrow') throw new Error('Accepted dashed arrow connection was not persisted.');
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 100 && !document.querySelector('.wb-inspector [role="group"][aria-label="Linienstil"]'); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    const group = (name) => document.querySelector('.wb-inspector [role="group"][aria-label="' + name + '"]');
    [...group('Linienstil').querySelectorAll('button')].find((item) => item.textContent?.includes('Durchgezogen'))?.click();
    [...group('Pfeilende').querySelectorAll('button')].find((item) => item.textContent?.includes('Ohne Pfeil'))?.click();
    let save;
    for (let attempt = 0; attempt < 100; attempt++) {
      save = [...document.querySelectorAll('.wb-inspector button')].find((item) => item.textContent?.includes('Verbindung speichern'));
      if (save && !save.disabled && [...group('Linienstil').querySelectorAll('button')].find((item) => item.textContent?.includes('Durchgezogen'))?.getAttribute('aria-pressed') === 'true'
        && [...group('Pfeilende').querySelectorAll('button')].find((item) => item.textContent?.includes('Ohne Pfeil'))?.getAttribute('aria-pressed') === 'true') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!save || save.disabled) throw new Error('Appearance changes did not become saveable.');
    save.click();
    for (let attempt = 0; attempt < 100; attempt++) {
      const path = document.querySelector('.wb-edge .react-flow__edge-path');
      if (path?.style.strokeDasharray === 'none' && !path.getAttribute('marker-end')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Updated solid connection is not visible: ' + document.querySelector('.wb-edge .react-flow__edge-path')?.outerHTML + ' / ' + document.querySelector('.wb-inspector')?.textContent?.slice(0, 300));
  })()`);
  const revised = whiteboardSnapshot(store, project.id).edges.find((item) => item.sourceId === newNode.id);
  if (revised?.lineStyle !== 'solid' || revised.endMarker !== 'none' || revised.updatedAt === styled.edges.find((item) => item.id === revised.id)?.updatedAt)
    throw new Error('Saved connection appearance did not survive the UI update.');
  window.setSize(860, 780);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const narrow = await window.webContents.executeJavaScript(`(() => {
    const view = document.querySelector('.wb-view');
    const canvas = document.querySelector('.wb-canvas');
    const inspector = document.querySelector('.wb-inspector');
    if (!view || !canvas || !inspector) throw new Error('Narrow Whiteboard fixture is incomplete.');
    return { overflow: view.scrollWidth - view.clientWidth, canvasBottom: canvas.getBoundingClientRect().bottom,
      inspectorTop: inspector.getBoundingClientRect().top };
  })()`);
  if (narrow.overflow > 2 || narrow.inspectorTop < narrow.canvasBottom - 2) throw new Error('Whiteboard does not fit the narrow desktop layout.');
  const libraryCount = whiteboardSnapshot(store, project.id).nodes.length;
  await window.webContents.executeJavaScript(`(() => {
    const library = document.querySelector('.wb-shape-rail');
    if (!library) throw new Error('Shape library is missing.');
    const documentButton = [...library.querySelectorAll('button')].find((button) => button.textContent?.includes('Dokument'));
    if (!documentButton || documentButton.disabled || documentButton.tabIndex < 0) throw new Error('Document shape has no keyboard route.');
    documentButton.focus();
    if (document.activeElement !== documentButton) throw new Error('Document shape cannot receive keyboard focus.');
    documentButton.click();
  })()`);
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (document.querySelector('.wb-unsaved-node.wb-shape-document')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Keyboard activation did not create the document draft.');
  })()`);
  if (whiteboardSnapshot(store, project.id).nodes.length !== libraryCount) throw new Error('Shape library draft wrote before acceptance.');
  await window.webContents.executeJavaScript(`(() => {
    const save = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Box übernehmen'));
    if (!save) throw new Error('Shape draft cannot be saved.');
    save.click();
  })()`);
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (!document.querySelector('.wb-unsaved-node')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Document draft did not complete its save.');
  })()`);
  const savedDocument = whiteboardSnapshot(store, project.id).nodes.find((item) => item.title === 'Neues Dokument');
  if (savedDocument?.shape !== 'document') throw new Error('Document shape did not survive the UI save.');
  await window.webContents.executeJavaScript(`(() => {
    const library = document.querySelector('.wb-shape-rail');
    const dataButton = [...library.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Daten');
    const canvas = document.querySelector('.wb-canvas');
    if (!dataButton || !canvas) throw new Error('Drag-to-place fixture is incomplete.');
    const transfer = new DataTransfer();
    dataButton.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    if (transfer.getData('application/x-branchloom-whiteboard-shape') !== 'data') throw new Error('Palette drag did not expose the selected shape.');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 120, clientY: rect.top + 120 }));
    canvas.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.left + 120, clientY: rect.top + 120 }));
  })()`);
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (document.querySelector('.wb-unsaved-node.wb-shape-data')) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Drag-to-place did not create the data draft.');
  })()`);
  const dropped = await window.webContents.executeJavaScript(`(() => {
    const canvas = document.querySelector('.wb-canvas').getBoundingClientRect();
    const shape = document.querySelector('.wb-unsaved-node.wb-shape-data').getBoundingClientRect();
    return { x: Math.abs(shape.left + shape.width / 2 - canvas.left - 120), y: Math.abs(shape.top + shape.height / 2 - canvas.top - 120) };
  })()`);
  if (dropped.x > 40 || dropped.y > 40) throw new Error('Dragged shape did not appear near its drop point: ' + JSON.stringify(dropped));
  if (whiteboardSnapshot(store, project.id).nodes.length !== libraryCount + 1) throw new Error('Dragged data draft wrote before acceptance.');
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Whiteboard resize timeout: ' + label);
    };
    [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Entwurf verwerfen'))?.click();
    const savedNode = await wait(() => document.querySelector('.react-flow__node[data-id=${JSON.stringify(savedDocument.id)}]'), 'saved document');
    savedNode.click();
    await wait(() => document.querySelectorAll('.wb-resize-handle').length >= 4, 'direct resize handles');
    const fields = [...document.querySelectorAll('.wb-inspector [role="group"][aria-label="Boxgröße"] input')];
    if (fields.length !== 2 || fields.some((input) => input.tabIndex < 0)) throw new Error('Keyboard geometry fields are missing.');
    const setNumber = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setNumber(fields[0], '320');
    setNumber(fields[1], '160');
    await wait(() => [...document.querySelectorAll('.wb-inspector button')].some((button) => button.textContent?.includes('Größe und Position übernehmen') && !button.disabled), 'unsaved size draft');
    return true;
  })()`);
  if (whiteboardSnapshot(store, project.id).nodes.find((node) => node.id === savedDocument.id)?.width !== null)
    throw new Error('Editing geometry wrote before explicit acceptance.');
  await window.webContents.executeJavaScript(`(async () => {
    const save = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Größe und Position übernehmen'));
    if (!save || save.disabled) throw new Error('Geometry draft cannot be accepted.');
    save.click();
    for (let attempt = 0; attempt < 80; attempt++) {
      if (![...document.querySelectorAll('.wb-inspector button')].some((button) => button.textContent?.includes('Größe und Position übernehmen'))) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Geometry save did not finish.');
  })()`);
  const resized = whiteboardSnapshot(store, project.id).nodes.find((node) => node.id === savedDocument.id);
  if (resized?.width !== 320 || resized.height !== 160) throw new Error('Accepted geometry was not persisted.');
  window.setSize(1280, 900);
  const resizeHandle = await window.webContents.executeJavaScript(`(async () => {
    document.querySelector('.react-flow__controls-fitview')?.click();
    let previous = '';
    let stableSince = Date.now();
    for (let attempt = 0; attempt < 80; attempt++) {
      const handles = [...document.querySelectorAll('.react-flow__node[data-id=${JSON.stringify(savedDocument.id)}] .wb-resize-handle')];
      const corner = handles.map((handle) => handle.getBoundingClientRect()).sort((a, b) => b.right + b.bottom - a.right - a.bottom)[0];
      const canvas = document.querySelector('.react-flow__pane')?.getBoundingClientRect();
      const visible = handles.some((handle) => getComputedStyle(handle).visibility === 'visible');
      const key = corner && canvas ? JSON.stringify({ x: Math.round(corner.x), y: Math.round(corner.y), cx: Math.round(canvas.x), cy: Math.round(canvas.y) }) : '';
      if (key !== previous) stableSince = Date.now();
      previous = key;
      if (visible && Date.now() - stableSince > 600 && corner && canvas && corner.left > canvas.left + 8 && corner.top > canvas.top + 8 && corner.right < canvas.right - 65 && corner.bottom < canvas.bottom - 45) {
        const node = document.querySelector('.react-flow__node[data-id=${JSON.stringify(savedDocument.id)}]')?.getBoundingClientRect();
        return { x: Math.round(corner.left + corner.width / 2), y: Math.round(corner.top + corner.height / 2), width: node?.width, height: node?.height };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Direct resize handle never settled inside the canvas.');
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: resizeHandle.x, y: resizeHandle.y, clickCount: 1 });
  await pause(60);
  for (let step = 1; step <= 6; step++) {
    const x = resizeHandle.x + step * 8;
    const y = resizeHandle.y + step * 5;
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y, movementX: 8, movementY: 5 });
    await pause(35);
  }
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: resizeHandle.x + 48, y: resizeHandle.y + 30, clickCount: 1 });
  await pause(180);
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const inputs = [...document.querySelectorAll('.wb-inspector [role="group"][aria-label="Boxgröße"] input')];
      const accept = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Größe und Position übernehmen'));
      const discard = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.trim() === 'Verwerfen');
      if (inputs.length === 2 && Number(inputs[0].value) > 320 && Number(inputs[1].value) > 160 && accept && !accept.disabled && discard) {
        discard.click();
        for (let followup = 0; followup < 40; followup++) {
          const restored = [...document.querySelectorAll('.wb-inspector [role="group"][aria-label="Boxgröße"] input')];
          if (restored[0]?.value === '320' && restored[1]?.value === '160'
            && ![...document.querySelectorAll('.wb-inspector button')].some((button) => button.textContent?.includes('Größe und Position übernehmen'))) {
            const box = document.querySelector('.react-flow__node[data-id=${JSON.stringify(savedDocument.id)}]')?.getBoundingClientRect();
            if (!box || Math.abs(box.width - ${resizeHandle.width}) > 2 || Math.abs(box.height - ${resizeHandle.height}) > 2)
              throw new Error('Discarding resize did not restore rendered node dimensions: ' + JSON.stringify({ current: box && [box.width, box.height], before: [${resizeHandle.width}, ${resizeHandle.height}] }));
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw new Error('Discarding direct resize did not restore saved geometry: ' + JSON.stringify({
          values: [...document.querySelectorAll('.wb-inspector [role="group"][aria-label="Boxgröße"] input')].map((input) => input.value),
          pending: [...document.querySelectorAll('.wb-inspector button')].some((button) => button.textContent?.includes('Größe und Position übernehmen')) }));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Dragging the resize handle did not produce an unsaved geometry draft.');
  })()`);
  if (whiteboardSnapshot(store, project.id).nodes.find((node) => node.id === savedDocument.id)?.width !== 320)
    throw new Error('Direct resize persisted before acceptance.');
  const secondHandle = await window.webContents.executeJavaScript(`(() => {
    const handles = [...document.querySelectorAll('.react-flow__node[data-id=${JSON.stringify(savedDocument.id)}] .wb-resize-handle')];
    const corner = handles.map((handle) => handle.getBoundingClientRect()).sort((a, b) => b.right + b.bottom - a.right - a.bottom)[0];
    if (!corner || document.elementFromPoint(corner.left + corner.width / 2, corner.top + corner.height / 2)?.classList.contains('wb-resize-handle') !== true)
      throw new Error('Saved box has no reachable direct resize handle.');
    return { x: Math.round(corner.left + corner.width / 2), y: Math.round(corner.top + corner.height / 2) };
  })()`);
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: secondHandle.x, y: secondHandle.y, clickCount: 1 });
  await pause(60);
  for (let step = 1; step <= 5; step++) {
    const x = secondHandle.x + step * 8;
    const y = secondHandle.y + step * 5;
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y, movementX: 8, movementY: 5 });
    await pause(35);
  }
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: secondHandle.x + 40, y: secondHandle.y + 25, clickCount: 1 });
  await pause(180);
  await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const inputs = [...document.querySelectorAll('.wb-inspector [role="group"][aria-label="Boxgröße"] input')];
      const accept = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Größe und Position übernehmen'));
      if (inputs.length === 2 && Number(inputs[0].value) > 320 && Number(inputs[1].value) > 160 && accept && !accept.disabled) {
        accept.click();
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Second direct resize did not reach its save action.');
  })()`);
  let handleSaved = whiteboardSnapshot(store, project.id).nodes.find((node) => node.id === savedDocument.id);
  for (let attempt = 0; attempt < 80 && (handleSaved?.width ?? 0) <= 320; attempt++) {
    await pause(50);
    handleSaved = whiteboardSnapshot(store, project.id).nodes.find((node) => node.id === savedDocument.id);
  }
  if (!handleSaved || (handleSaved.width ?? 0) <= 320 || (handleSaved.height ?? 0) <= 160)
    throw new Error('Direct resize was not persisted after acceptance.');
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Whiteboard reload timeout: ' + label);
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === ${JSON.stringify(`${projectName} auswählen`)}), 'project choice');
    choice.click();
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Whiteboard'), 'whiteboard navigation');
    nav.click();
    const resized = await wait(() => document.querySelector('.react-flow__node[data-id=${JSON.stringify(savedDocument.id)}]'), 'persisted resized node');
    if (Math.round(parseFloat(resized.style.width)) !== ${handleSaved.width} || Math.round(parseFloat(resized.style.height)) !== ${handleSaved.height})
      throw new Error('Direct resize dimensions were not rendered after app reload.');
    return true;
  })()`);

  // Draw a free annotation on the real Flow canvas. It must remain local until accepted.
  const freeLineDrag = await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Free-line UI timeout: ' + label);
    };
    const tool = await wait(() => [...document.querySelectorAll('.wb-shape-rail button')].find((button) => button.textContent?.trim() === 'Linie'), 'line tool');
    if (tool.disabled || tool.tabIndex < 0) throw new Error('Line tool has no keyboard route.');
    tool.click();
    const overlay = await wait(() => document.querySelector('.wb-line-draw-surface'), 'drawing surface');
    const box = overlay.getBoundingClientRect();
    return { x1: Math.round(box.left + box.width * .25), y1: Math.round(box.top + box.height * .37),
      x2: Math.round(box.left + box.width * .60), y2: Math.round(box.top + box.height * .55) };
  })()`);
  if (whiteboardFreeLines(store, project.id).length) throw new Error('Entering line mode wrote to the database.');
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', x: freeLineDrag.x1, y: freeLineDrag.y1, clickCount: 1 });
  await pause(70);
  for (let step = 1; step <= 6; step++) {
    const x = Math.round(freeLineDrag.x1 + (freeLineDrag.x2 - freeLineDrag.x1) * step / 6);
    const y = Math.round(freeLineDrag.y1 + (freeLineDrag.y2 - freeLineDrag.y1) * step / 6);
    window.webContents.sendInputEvent({ type: 'mouseMove', x, y, movementX: x - freeLineDrag.x1, movementY: y - freeLineDrag.y1 });
    await pause(35);
  }
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', x: freeLineDrag.x2, y: freeLineDrag.y2, clickCount: 1 });
  const draftBounds = await window.webContents.executeJavaScript(`(async () => {
    for (let attempt = 0; attempt < 80; attempt++) {
      const draft = document.querySelector('.wb-free-line.is-draft .wb-free-line-stroke');
      const save = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Linie übernehmen'));
      if (draft && save && !save.disabled) {
        if (!/^M[^MLCQZ]+L[^MLCQZ]+$/i.test(draft.getAttribute('d') ?? '')) throw new Error('Free line is not straight.');
        const box = draft.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Pointer drag did not produce a free-line draft: ' + document.querySelector('.wb-inspector')?.textContent?.slice(0, 300));
  })()`);
  if (Math.abs(draftBounds.left - freeLineDrag.x1) > 18 || Math.abs(draftBounds.top - freeLineDrag.y1) > 18
    || Math.abs(draftBounds.right - freeLineDrag.x2) > 18 || Math.abs(draftBounds.bottom - freeLineDrag.y2) > 18)
    throw new Error('Free-line draft is not aligned with the pointer path: ' + JSON.stringify({ draftBounds, freeLineDrag }));
  if (whiteboardFreeLines(store, project.id).length) throw new Error('Free-line drag wrote before acceptance.');
  await window.webContents.executeJavaScript(`(async () => {
    const group = (name) => document.querySelector('.wb-inspector [role="group"][aria-label="' + name + '"]');
    [...group('Linienstil').querySelectorAll('button')].find((button) => button.textContent?.includes('Gestrichelt'))?.click();
    [...group('Pfeilende').querySelectorAll('button')].find((button) => button.textContent?.includes('Mit Pfeil'))?.click();
    for (let attempt = 0; attempt < 80; attempt++) {
      const dashed = [...group('Linienstil').querySelectorAll('button')].find((button) => button.textContent?.includes('Gestrichelt'));
      const arrow = [...group('Pfeilende').querySelectorAll('button')].find((button) => button.textContent?.includes('Mit Pfeil'));
      if (dashed?.getAttribute('aria-pressed') === 'true' && arrow?.getAttribute('aria-pressed') === 'true') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const save = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Linie übernehmen'));
    save?.click();
    for (let attempt = 0; attempt < 80; attempt++) {
      if (!document.querySelector('.wb-free-line.is-draft') && document.querySelector('.wb-free-line-hit')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Free-line save did not finish.');
  })()`);
  const savedFreeLines = whiteboardFreeLines(store, project.id);
  if (savedFreeLines.length !== 1 || savedFreeLines[0]?.lineStyle !== 'dashed' || savedFreeLines[0]?.endMarker !== 'arrow')
    throw new Error('Free line style did not persist.');
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    const wait = async (predicate, label) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('Free-line reload timeout: ' + label);
    };
    const picker = await wait(() => document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)'), 'project picker');
    picker.click();
    const choice = await wait(() => [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
      .find((item) => item.getAttribute('aria-label') === ${JSON.stringify(`${projectName} auswählen`)}), 'project choice');
    choice.click();
    const nav = await wait(() => [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
      .find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Whiteboard'), 'whiteboard navigation');
    nav.click();
    const hit = await wait(() => document.querySelector('.wb-free-line-hit'), 'persisted line');
    hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(() => document.querySelector('.wb-inspector h3')?.textContent === 'Freie Linie', 'line inspector');
    const group = document.querySelector('.wb-inspector [role="group"][aria-label="Linienstil"]');
    [...group.querySelectorAll('button')].find((button) => button.textContent?.includes('Durchgezogen'))?.click();
    await wait(() => [...group.querySelectorAll('button')].find((button) => button.textContent?.includes('Durchgezogen'))?.getAttribute('aria-pressed') === 'true', 'solid line selection');
    const update = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Änderung speichern'));
    update?.click();
    await wait(() => document.querySelector('.wb-free-line-stroke')?.getAttribute('stroke-dasharray') !== '6 4', 'updated line style');
    return true;
  })()`);
  for (let attempt = 0; attempt < 80 && whiteboardFreeLines(store, project.id)[0]?.lineStyle !== 'solid'; attempt++) await pause(50);
  if (whiteboardFreeLines(store, project.id)[0]?.lineStyle !== 'solid') throw new Error('Free-line update did not persist.');
  await window.webContents.executeJavaScript(`(async () => {
    window.confirm = () => true;
    const remove = [...document.querySelectorAll('.wb-inspector button')].find((button) => button.textContent?.includes('Linie entfernen'));
    if (!remove) throw new Error('Free-line deletion action missing.');
    remove.click();
    for (let attempt = 0; attempt < 80; attempt++) {
      if (!document.querySelector('.wb-free-line-hit')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Free-line deletion did not update the canvas.');
  })()`);
  if (whiteboardFreeLines(store, project.id).length) throw new Error('Free-line deletion did not persist.');

  const standaloneRepo = join(root, 'standalone-line-repo');
  mkdirSync(standaloneRepo, { recursive: true });
  git(standaloneRepo, ['init', '-q']);
  const standaloneProject = store.createProject({ name: 'Standalone line board', path: standaloneRepo });
  createWhiteboardFreeLine(store, { projectId: standaloneProject.id, x1: 20, y1: 30, x2: 200, y2: 30 });
  await new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload(); });
  await window.webContents.executeJavaScript(`(async () => {
    let picker;
    for (let attempt = 0; attempt < 80; attempt++) {
      picker = document.querySelector('.sidebar-projects .project-switcher-trigger:not(.is-compact)');
      if (picker) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!picker) throw new Error('Standalone project picker is missing.');
    picker.click();
    for (let attempt = 0; attempt < 80; attempt++) {
      const choice = [...document.querySelectorAll('.project-switcher-panel .project-switcher-project > button:first-child')]
        .find((button) => button.getAttribute('aria-label') === 'Standalone line board auswählen');
      if (choice) { choice.click(); break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (let attempt = 0; attempt < 80 && !document.querySelector('.sidebar-projects .project-switcher-trigger')?.textContent?.includes('Standalone line board'); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    for (let attempt = 0; attempt < 80; attempt++) {
      const nav = [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')]
        .find((button) => button.querySelector('.nav-label')?.textContent?.trim() === 'Whiteboard');
      if (nav) { nav.click(); break; }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (let attempt = 0; attempt < 80; attempt++) {
      if (document.querySelector('.wb-free-line-hit') && document.querySelector('.wb-shape-rail') && !document.querySelector('.wb-proposal-node')) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('A board containing only a free line fell back to the repository preview: ' + JSON.stringify({
      project: document.querySelector('.sidebar-projects .project-switcher-trigger')?.textContent?.trim(),
      view: document.querySelector('.wb-view')?.textContent?.slice(0, 260),
      line: Boolean(document.querySelector('.wb-free-line-hit')),
      rail: Boolean(document.querySelector('.wb-shape-rail')),
      repo: Boolean(document.querySelector('.wb-proposal-node')) }));
  })()`);
}
