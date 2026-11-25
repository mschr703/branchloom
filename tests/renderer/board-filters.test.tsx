import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, ProjectSnapshot } from '../../src/shared/types';
import { filterBoardCards } from '../../src/renderer/board-filters';
import { BoardView, boardEmptyMessage, isMoveShortcut, moveDestinations } from '../../src/renderer/components/BoardView';
import { CardPanel } from '../../src/renderer/components/CardPanel';

const stamp = '2026-01-01T00:00:00.000Z';
const cards: Card[] = [
  { id: 'active', projectId: 'p', columnId: 'todo', title: 'Aktive Suche', description: 'Wichtig', priority: 'urgent', labels: ['Kundenmail', 'Heute'], position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: null },
  { id: 'archived', projectId: 'p', columnId: 'done', title: 'Alte Aufgabe', description: 'Historie behalten', priority: 'low', labels: ['Archiv'], position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: stamp },
];

describe('board filters and archive visibility', () => {
  it('offers keyboard moves only for active cards and ignores modified shortcuts', () => {
    const columns = [
      { id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null },
      { id: 'done', projectId: 'p', name: 'Done', position: 1, autoStart: true, agentId: 'agent', model: null, effort: null },
    ];
    expect(moveDestinations(columns, cards[0]!).map((column) => column.id)).toEqual(['done']);
    expect(moveDestinations(columns, cards[1]!)).toEqual([]);
    expect(moveDestinations(columns.slice(0, 1), cards[0]!)).toEqual([]);
    expect(isMoveShortcut({ key: 'm', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true);
    expect(isMoveShortcut({ key: 'M', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(true);
    expect(isMoveShortcut({ key: 'm', altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBe(false);
    expect(isMoveShortcut({ key: 'Enter', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(false);
  });

  it('filters by text, column and archive state without removing stored cards', () => {
    expect(filterBoardCards(cards, { query: '', columnId: '', visibility: 'active' }).map((card) => card.id)).toEqual(['active']);
    expect(filterBoardCards(cards, { query: 'historie', columnId: '', visibility: 'all' }).map((card) => card.id)).toEqual(['archived']);
    expect(filterBoardCards(cards, { query: '', columnId: 'done', visibility: 'archived' }).map((card) => card.id)).toEqual(['archived']);
    expect(filterBoardCards(cards, { query: '', columnId: 'todo', visibility: 'archived' })).toEqual([]);
    expect(cards).toHaveLength(2);
  });

  it('combines exact priority and label filters and searches label text', () => {
    expect(filterBoardCards(cards, { query: '', columnId: '', visibility: 'all', priority: 'urgent', label: 'kundenmail' }).map((card) => card.id)).toEqual(['active']);
    expect(filterBoardCards(cards, { query: '', columnId: '', visibility: 'all', priority: 'low', label: 'Kundenmail' })).toEqual([]);
    expect(filterBoardCards(cards, { query: 'heute', columnId: '', visibility: 'active' }).map((card) => card.id)).toEqual(['active']);
  });

  it('renders only active cards on the normal board and exposes archive filter', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Synthetic', path: 'C:\\test', createdAt: stamp },
      columns: [
        { id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null },
        { id: 'done', projectId: 'p', name: 'Done', position: 1, autoStart: false, agentId: null, model: null, effort: null },
      ],
      cards, agents: [], sessions: [], workflows: [], notes: [],
    };
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('Aktive Suche');
    expect(html).not.toContain('Alte Aufgabe');
    expect(html).toContain('Archiv (1)');
    expect(html).toContain('Karten suchen');
    expect(html).toContain('Priorität filtern');
    expect(html).toContain('Label filtern');
    expect(html).toContain('Dringend');
    expect(html).toContain('Kundenmail');
    expect(html).toContain('Spalte filtern');
    expect(html).toContain('role="search"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-keyshortcuts="M"');
    expect(html).toContain('Verschieben');
    expect(html).toContain('Karte „Aktive Suche“ in „To Do“ öffnen');
    expect(html).toContain('Schnellaktionen für „Aktive Suche“');
    expect(html).toContain('aria-expanded="false"');
    const activePanel = renderToStaticMarkup(createElement(CardPanel, { card: cards[0]!, snapshot, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined }));
    expect(activePanel).toContain('aria-label="Neues Label"');
    expect(activePanel).toContain('aria-label="Label Kundenmail entfernen"');
    expect(activePanel).toContain('aria-label="Label Heute entfernen"');
    expect(activePanel).toContain('Label anlegen oder auswählen');
    expect(activePanel).toContain('<option value="urgent" selected=""');
    const archived = renderToStaticMarkup(createElement(CardPanel, { card: cards[1]!, snapshot, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined }));
    expect(archived).toContain('Wiederherstellen');
    expect(archived).toContain('ARCHIVIERT');
    expect(archived).toContain('disabled=""');
  });

  it('keeps session controls in the card drawer instead of claiming a universal resume action', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Synthetic', path: 'C:\\test', createdAt: stamp },
      columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
      cards: [cards[0]!],
      agents: [{ id: 'agent', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
      sessions: [{ id: 'run', projectId: 'p', cardId: 'active', agentId: 'agent', state: 'exited', startedAt: stamp, endedAt: stamp, exitCode: 0, output: '', codexThreadId: 'thread', worktreePath: 'C:\\synthetic-worktree' }],
      workflows: [], notes: [],
      queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
    };
    const board = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(board).toContain('Schnellaktionen für „Aktive Suche“');
    expect(board).not.toContain('Resume Session');
    const panel = renderToStaticMarkup(createElement(CardPanel, { card: cards[0]!, snapshot, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined, onOpenCard: () => undefined, focusSession: true }));
    expect(panel).toContain('Dieses Gespräch fortsetzen');
    expect(panel).toContain('tabindex="-1"');
  });

  it('keeps QA reachable in the toolbar and hides empty bulk controls', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Empty', path: 'C:\\test', createdAt: stamp },
      columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
      cards: [], agents: [], sessions: [], workflows: [], notes: [],
    };
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toMatch(/class="board-toolbar board-header-actions"[\s\S]*class="qa-coverage"/);
    expect(html).toContain('UI-Prüfung');
    expect(html).not.toContain('Sichtbare aktive Karten auswählen');
    expect(html).not.toContain('class="board-bulk-actions"');
    expect(html).toContain('Erstelle unten deine erste Aufgabe. Verschiebe sie später zwischen den Spalten.');
    expect(html).not.toContain('Karten hierher ziehen');
  });

  it('guides only the first empty column and distinguishes filtered empty results', () => {
    expect(boardEmptyMessage(0, false, false)).toContain('erste Aufgabe');
    expect(boardEmptyMessage(1, false, false)).toBeNull();
    expect(boardEmptyMessage(0, true, false)).toBe('Karten hierher ziehen');
    expect(boardEmptyMessage(0, false, true)).toBe('Keine passenden Karten');
  });
});
