import type { BrowserWindow } from 'electron';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureCardWorktree } from './git-worktree';
import { manualRevisions, previewManualRevision } from './manual-revision';
import type { StudioStore } from './store';

export async function runF03Acceptance(smokeWindow: BrowserWindow, smokeStore: StudioStore, dataDirectory: string): Promise<void> {
  const f03Root = join(dataDirectory, 'f03-manual-project');
  mkdirSync(f03Root);
  const f03File = join(f03Root, 'form.txt');
  const f03Base = 'title=Old\nspacing=8\nhelper=Name\nvalidation=none\n';
  writeFileSync(f03File, f03Base);
  execFileSync('git', ['init', '-q', f03Root], { windowsHide: true });
  execFileSync('git', ['-C', f03Root, 'add', 'form.txt'], { windowsHide: true });
  execFileSync('git', ['-C', f03Root, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic F03 base'], { windowsHide: true });
  const f03Project = smokeStore.createProject({ name: 'F03 manual revisions', path: f03Root });
  const f03Column = smokeStore.snapshot(f03Project.id).columns[0]!.id;
  const f03Simple = smokeStore.createCard({ projectId: f03Project.id, columnId: f03Column, title: 'F03 non-overlapping changes' });
  const f03Conflict = smokeStore.createCard({ projectId: f03Project.id, columnId: f03Column, title: 'F03 overlapping changes' });
  const f03SimpleWorktree = ensureCardWorktree(smokeStore, f03Simple.id);
  const f03ConflictWorktree = ensureCardWorktree(smokeStore, f03Conflict.id);
  writeFileSync(join(f03SimpleWorktree.path, 'form.txt'), f03Base.replace('validation=none', 'validation=required'));
  writeFileSync(join(f03ConflictWorktree.path, 'form.txt'), f03Base.replace('title=Old', 'title=Agent'));
  for (const path of [f03SimpleWorktree.path, f03ConflictWorktree.path]) {
    execFileSync('git', ['-C', path, 'add', 'form.txt'], { windowsHide: true });
    execFileSync('git', ['-C', path, '-c', 'user.name=Branchloom Smoke', '-c', 'user.email=smoke@example.invalid', 'commit', '-qm', 'Synthetic F03 agent edit'], { windowsHide: true });
  }
  writeFileSync(f03File, f03Base.replace('title=Old', 'title=Manual').replace('spacing=8', 'spacing=12'));
  await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
  await smokeWindow.webContents.executeJavaScript(`(async () => {
    const wait = async (get, label) => {
      for (let attempt = 0; attempt < 600; attempt++) {
        const found = await get();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('F03 missing ' + label + ': ' + document.querySelector('.manual-revision')?.textContent?.slice(-600));
    };
    const project = await wait(() => document.querySelector('#project-select option[value=${JSON.stringify(f03Project.id)}]'), 'project option');
    const projectSelect = document.querySelector('#project-select');
    const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!(projectSelect instanceof HTMLSelectElement) || !setSelect || !project) throw new Error('F03 project selector unavailable.');
    setSelect.call(projectSelect, ${JSON.stringify(f03Project.id)}); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
    [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Board')?.click();
    await wait(() => document.querySelector('#board-card-${f03Simple.id}'), 'first card');
    document.querySelector('#board-card-${f03Simple.id}').click();
    const panel = await wait(() => document.querySelector('.manual-revision'), 'manual revision panel');
    panel.querySelector('button[aria-expanded="false"]')?.click();
    await wait(() => panel.querySelector('select option[value="form.txt"]'), 'tracked target file');
    const captureButton = await wait(() => [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Änderung festhalten') && !item.disabled), 'enabled capture button');
    captureButton.click();
    const result = await wait(() => panel.querySelector('.manual-revision-result'), 'non-overlapping comparison');
    await wait(() => result.querySelector('button')?.textContent?.includes('zusammengeführt schreiben'), 'non-overlapping apply');
    if (!result.textContent?.includes('Zusammenführbar') || !result.textContent?.includes('title=Manual') || !result.textContent?.includes('validation=required')) throw new Error('F03 non-overlapping preview lost one side.');
    result.querySelector('button')?.click();
    const applied = await wait(async () => (await window.studio.manualRevisions(${JSON.stringify(f03Simple.id)})).find((item) => item.appliedAt), 'applied revision receipt');
    for (let attempt = 0; attempt < 600 && !panel.textContent?.includes('already applied') && !panel.querySelector('[role="alert"]'); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!panel.textContent?.includes('already applied')) throw new Error('F03 apply saved but UI did not show completion: ' + JSON.stringify({ appliedAt: applied.appliedAt, panel: panel.textContent?.slice(-500) }));
    document.querySelector('button[aria-label="Karte schließen"]')?.click();
    await wait(() => !document.querySelector('.manual-revision'), 'first card close');
    document.querySelector('#board-card-${f03Conflict.id}')?.click();
    const conflictPanel = await wait(() => document.querySelector('.manual-revision'), 'conflicting card panel');
    conflictPanel.querySelector('button[aria-expanded="false"]')?.click();
    await wait(() => conflictPanel.querySelector('select option[value="form.txt"]'), 'conflicting target file');
    const conflictCapture = await wait(() => [...conflictPanel.querySelectorAll('button')].find((item) => item.textContent?.includes('Änderung festhalten') && !item.disabled), 'enabled conflict capture');
    conflictCapture.click();
    const conflict = await wait(() => conflictPanel.querySelector('.manual-revision-conflicts fieldset'), 'conflict block');
    if (!conflict.textContent?.includes('title=Old') || !conflict.textContent?.includes('title=Manual') || !conflict.textContent?.includes('title=Agent') || conflictPanel.textContent?.includes('Diese Datei zusammengeführt schreiben')) throw new Error('F03 unresolved conflict did not show the three source versions or was writable.');
    conflict.querySelector('input[type="radio"]')?.click();
    await wait(() => conflictPanel.textContent?.includes('Diese Datei zusammengeführt schreiben'), 'resolved conflict preview');
    return true;
  })()`);
  const f03ExpectedFirst = f03Base.replace('title=Old', 'title=Manual').replace('spacing=8', 'spacing=12').replace('validation=none', 'validation=required');
  if (readFileSync(f03File, 'utf8') !== f03ExpectedFirst) throw new Error('F03 non-overlapping UI apply did not retain both sides.');
  await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
  await smokeWindow.webContents.executeJavaScript(`(async () => {
    const wait = async (get, label) => { for (let attempt = 0; attempt < 600; attempt++) { const found = await get(); if (found) return found; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('F03 missing ' + label + ': ' + document.querySelector('.manual-revision')?.textContent?.slice(-600)); };
    const projectSelect = await wait(() => document.querySelector('#project-select'), 'project selector after reload');
    const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!setSelect) throw new Error('F03 project setter unavailable.');
    setSelect.call(projectSelect, ${JSON.stringify(f03Project.id)}); projectSelect.dispatchEvent(new Event('change', { bubbles: true }));
    [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Board')?.click();
    await wait(() => document.querySelector('#board-card-${f03Conflict.id}'), 'conflicting card after reload');
    document.querySelector('#board-card-${f03Conflict.id}').click();
    const panel = await wait(() => document.querySelector('.manual-revision'), 'manual panel after reload');
    panel.querySelector('button[aria-expanded="false"]')?.click();
    await wait(() => panel.querySelectorAll('.manual-revision-row select').length > 1, 'saved revision after reload');
    const compareButton = await wait(() => [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Dreifachvergleich öffnen') && !item.disabled), 'enabled comparison button');
    compareButton.click();
    const choice = await wait(() => panel.querySelector('.manual-revision-conflicts input[type="radio"]:checked'), 'persisted conflict choice');
    if (!choice.closest('label')?.textContent?.includes('Manuelle Fassung übernehmen')) throw new Error('F03 conflict decision did not survive renderer reload.');
    const edit = await wait(() => [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Eigene Fassung schreiben')), 'custom conflict editor button');
    edit.click();
    const field = await wait(() => panel.querySelector('.manual-revision-editor textarea'), 'custom conflict text area');
    const setText = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!(field instanceof HTMLTextAreaElement) || !setText) throw new Error('F03 custom editor is unavailable.');
    const pendingApply = [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Diese Datei zusammengeführt schreiben'));
    if (!(pendingApply instanceof HTMLButtonElement) || !pendingApply.disabled) throw new Error('F03 unsaved conflict edit still allows writing the target file.');
    const lockedButtons = ['Schließen', 'Dateien aktualisieren', 'Änderung festhalten', 'Dreifachvergleich öffnen', 'Manuelle Fassung übernehmen'];
    if (lockedButtons.some((label) => {
      if (label === 'Manuelle Fassung übernehmen') return !panel.querySelector('.manual-revision-choices input[type="radio"]')?.disabled;
      const button = [...panel.querySelectorAll('button')].find((item) => item.textContent?.trim() === label);
      return !(button instanceof HTMLButtonElement) || !button.disabled;
    }) || [...panel.querySelectorAll('.manual-revision-row select')].some((item) => !item.disabled))
      throw new Error('F03 open draft still permits another file, revision or conflict decision.');
    const cancel = [...panel.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Abbrechen');
    if (!(cancel instanceof HTMLButtonElement) || cancel.disabled) throw new Error('F03 cannot cancel the open conflict draft.');
    setText.call(field, 'title=Both\\n'); field.dispatchEvent(new Event('input', { bubbles: true }));
    const save = await wait(() => [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Auswahl speichern') && !item.disabled), 'custom conflict save button');
    save.click();
    await wait(() => panel.textContent?.includes('Gespeicherte eigene Fassung') && panel.textContent?.includes('title=Both'), 'saved custom conflict result');
    await wait(() => panel.textContent?.includes('Diese Datei zusammengeführt schreiben'), 'custom result ready to apply');
    return true;
  })()`);
  const editedConflictRevision = manualRevisions(smokeStore, f03Conflict.id)[0];
  if (!editedConflictRevision || previewManualRevision(smokeStore, editedConflictRevision.id).conflicts[0]?.customText !== 'title=Both\n')
    throw new Error('F03 custom conflict text was not stored after the visible edit.');
  await new Promise<void>((resolve) => { smokeWindow.webContents.once('did-finish-load', () => resolve()); smokeWindow.webContents.reload(); });
  await smokeWindow.webContents.executeJavaScript(`(async () => {
    const wait = async (get, label) => { for (let attempt = 0; attempt < 600; attempt++) { const found = await get(); if (found) return found; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('F03 missing ' + label); };
    const select = await wait(() => document.querySelector('#project-select'), 'project after custom edit reload');
    const setSelect = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (!setSelect) throw new Error('F03 project selector setter unavailable.');
    setSelect.call(select, ${JSON.stringify(f03Project.id)}); select.dispatchEvent(new Event('change', { bubbles: true }));
    [...document.querySelectorAll('nav[aria-label="Hauptnavigation"] button')].find((item) => item.querySelector('.nav-label')?.textContent?.trim() === 'Board')?.click();
    await wait(() => document.querySelector('#board-card-${f03Conflict.id}'), 'custom conflict card after reload');
    document.querySelector('#board-card-${f03Conflict.id}').click();
    const panel = await wait(() => document.querySelector('.manual-revision'), 'custom conflict panel after reload');
    panel.querySelector('button[aria-expanded="false"]')?.click();
    const compare = await wait(() => [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Dreifachvergleich öffnen') && !item.disabled), 'custom conflict compare button');
    compare.click();
    await wait(() => panel.textContent?.includes('Gespeicherte eigene Fassung') && panel.textContent?.includes('title=Both'), 'persisted custom conflict after reload');
    if (!panel.textContent?.includes('Diese Datei zusammengeführt schreiben')) throw new Error('F03 persisted custom choice is not ready for apply.');
    return true;
  })()`);
  const f03Newer = f03ExpectedFirst.replace('helper=Name', 'helper=Updated');
  writeFileSync(f03File, f03Newer);
  const latestConflictRevision = manualRevisions(smokeStore, f03Conflict.id)[0];
  if (!latestConflictRevision || !previewManualRevision(smokeStore, latestConflictRevision.id).staleReason?.includes('Target file changed')) {
    throw new Error('F03 target edit was not detected as a stale comparison.');
  }
  await smokeWindow.webContents.executeJavaScript(`(async () => {
    const panel = document.querySelector('.manual-revision');
    const apply = [...panel.querySelectorAll('button')].find((item) => item.textContent?.includes('Diese Datei zusammengeführt schreiben'));
    if (!(apply instanceof HTMLButtonElement)) throw new Error('F03 reviewed apply button missing before stale edit.');
    apply.click();
    const staleVisible = () => [...panel.querySelectorAll('[role="alert"]')].some((item) => item.textContent?.toLowerCase().includes('stale'));
    const canWrite = () => [...panel.querySelectorAll('button')].some((item) => item.textContent?.includes('Diese Datei zusammengeführt schreiben'));
    for (let attempt = 0; attempt < 600 && (!staleVisible() || canWrite()); attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!staleVisible() || canWrite()) throw new Error('F03 stale target was not visibly refused: ' + JSON.stringify({ alerts: [...panel.querySelectorAll('[role="alert"]')].map((item) => item.textContent), canWrite: canWrite() }));
    if (![...panel.querySelectorAll('button')].some((item) => item.textContent?.includes('Änderung festhalten'))) throw new Error('F03 cannot offer a fresh capture after stale refusal.');
    return true;
  })()`);
  if (readFileSync(f03File, 'utf8') !== f03Newer) throw new Error('F03 stale preview overwrote the newer target file.');
}
