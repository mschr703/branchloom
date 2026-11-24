import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardView, BulkArchiveConfirmation, BulkPriorityConfirmation } from '../../src/renderer/components/BoardView';
import type { ProjectSnapshot } from '../../src/shared/types';

const stamp = '2026-01-01T00:00:00.000Z';
const base: ProjectSnapshot = {
  project: { id: 'p', name: 'Synthetic', path: 'C:\\synthetic', createdAt: stamp },
  columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: true, agentId: 'agent', model: null, effort: null }],
  cards: [
    { id: 'active', projectId: 'p', columnId: 'todo', title: 'Active', description: '', priority: 'none', labels: [], position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: null },
    { id: 'archived', projectId: 'p', columnId: 'todo', title: 'Archived', description: '', priority: 'none', labels: [], position: 1, createdAt: stamp, updatedAt: stamp, archivedAt: stamp },
  ],
  agents: [{ id: 'agent', name: 'Synthetic agent', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [], workflows: [], notes: [],
  queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};
const mutate = async <T,>(action: () => Promise<T>) => action();

describe('bulk board controls', () => {
  it('offers selection only for visible active cards without an empty bulk-action notice', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot: base, mutate }));
    expect(html).toContain('Sichtbare aktive Karten auswählen');
    expect(html).toContain('„Active“ für Sammelaktion auswählen');
    expect(html).not.toContain('„Archived“ für Sammelaktion auswählen');
    expect(html).not.toContain('Sammelverschieben startet keine Spaltenagenten.');
    expect(html).not.toContain('Archivierung bestätigen');
  });

  it('shows a bounded priority confirmation with the affected count and cancel path', () => {
    const confirmation = renderToStaticMarkup(createElement(BulkPriorityConfirmation, { selectedCount: 3, changeCount: 2, priorityLabel: 'Hoch', busy: false, onConfirm: () => undefined, onCancel: () => undefined }));
    expect(confirmation).toContain('3 Karten auf „Hoch“ setzen?');
    expect(confirmation).toContain('2 davon ändern sich. Kein Agent wird gestartet.');
    expect(confirmation).toContain('Priorität setzen');
    expect(confirmation).toContain('Abbrechen');
  });

  it('shows queue pause requirement and explicit two-step archive confirmation', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot: { ...base, queue: { ...base.queue, state: 'running' } }, mutate }));
    expect(html).toContain('Warteschlange vor Sammelaktionen pausieren.');
    const confirmation = renderToStaticMarkup(createElement(BulkArchiveConfirmation, { count: 2, busy: false, onConfirm: () => undefined, onCancel: () => undefined }));
    expect(confirmation).toContain('2 Karten archivieren?');
    expect(confirmation).toContain('Archivierung bestätigen');
    expect(confirmation).toContain('Abbrechen');
    expect(confirmation).toContain('wiederherstellbar');
  });
});
