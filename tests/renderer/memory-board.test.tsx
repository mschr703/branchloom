import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MemoryNote, ProjectSnapshot } from '../../src/shared/types';
import { backlinks, graphScope, layoutFocusedNotes, layoutNetworkNotes, layoutNotes, linkedIdsForBody, noteEdges } from '../../src/renderer/memory-graph';
import { BoardView } from '../../src/renderer/components/BoardView';
import { MemoryView } from '../../src/renderer/components/MemoryView';

function note(id: string, title: string, body = '', links: string[] = []): MemoryNote {
  return { id, projectId: 'p', title, body, links, tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
}

describe('memory graph', () => {
  it('combines stored links and wiki links, deduplicates them, and exposes backlinks', () => {
    const notes = [note('a', 'Alpha', 'See [[Beta]] and [[Missing]].', ['b']), note('b', 'Beta'), note('c', 'Gamma', '[[Beta]]')];
    expect(noteEdges(notes)).toEqual([{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }]);
    expect(backlinks(notes, 'b').map((item) => item.id)).toEqual(['a', 'c']);
    expect(linkedIdsForBody('[[Beta]] [[Beta]] [[Unknown]]', notes)).toEqual(['b']);
  });

  it('places a single note in the center and multiple notes within the viewport', () => {
    expect(layoutNotes([note('a', 'Alpha')], 600, 300)[0]).toMatchObject({ x: 300, y: 150 });
    for (const node of layoutNotes([note('a', 'Alpha'), note('b', 'Beta'), note('c', 'Gamma')], 600, 300)) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(600);
      expect(node.y).toBeGreaterThan(0);
      expect(node.y).toBeLessThan(300);
    }
  });

  it('shows only existing direct relationships around a selected note', () => {
    const notes = [note('a', 'Alpha', '[[Beta]]'), note('b', 'Beta'), note('c', 'Gamma', '[[Alpha]]'), note('d', 'Unrelated')];
    const focused = graphScope(notes, 'a', 'focus');
    expect(focused.focused).toBe(true);
    expect(focused.notes.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(focused.edges).toEqual([{ from: 'a', to: 'b' }, { from: 'c', to: 'a' }]);
    expect(graphScope(notes, 'missing', 'focus').notes).toHaveLength(4);
    expect(graphScope(notes, 'a', 'all').notes).toHaveLength(4);
    expect(layoutFocusedNotes(focused.notes)[0]).toMatchObject({ id: 'a', x: 320, y: 200 });
  });

  it('bounds crowded focus views and keeps the selected note visible', () => {
    const notes = [note('center', 'Center'), ...Array.from({ length: 30 }, (_, index) => note(`n${index}`, `Note ${index}`, '[[Center]]'))];
    const focused = graphScope(notes, 'center', 'focus');
    expect(focused.notes).toHaveLength(24);
    expect(focused.hiddenCount).toBe(7);
    expect(focused.notes[0]?.id).toBe('center');
    expect(layoutFocusedNotes(focused.notes).every((item) => item.x > 0 && item.x < 640 && item.y > 0 && item.y < 400)).toBe(true);
  });

  it('lays out the overview deterministically within the graph bounds', () => {
    const notes = [note('a', 'Alpha', '[[Beta]]'), note('b', 'Beta'), note('c', 'Gamma'), note('d', 'Delta')];
    const first = layoutNetworkNotes(notes, noteEdges(notes));
    expect(layoutNetworkNotes(notes, noteEdges(notes))).toEqual(first);
    expect(first.every((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && item.x >= 45 && item.x <= 595 && item.y >= 45 && item.y <= 355)).toBe(true);
  });
});

describe('memory workspace', () => {
  it('places the graph beside the note list and exposes keyboard-reachable graph nodes', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Test', path: 'C:\\test', createdAt: '2026-01-01T00:00:00Z' },
      columns: [], cards: [], agents: [], sessions: [], workflows: [],
      notes: [note('a', 'Alpha', '[[Beta]]'), note('b', 'Beta')],
    };
    const html = renderToStaticMarkup(createElement(MemoryView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html.indexOf('aria-label="Automatischer Projektindex"')).toBeLessThan(html.indexOf('class="memory-list"'));
    expect(html).toContain('aria-label="Projektwissen durchsuchen"');
    expect(html).toContain('Index aktualisieren');
    expect(html).toContain('Eigene Notizen');
    expect(html.indexOf('class="memory-list"')).toBeLessThan(html.indexOf('class="graph-panel"'));
    expect(html.indexOf('class="graph-panel"')).toBeLessThan(html.indexOf('class="memory-main"'));
    expect(html).toContain('aria-label="Graphansicht"');
    expect(html).toContain('aria-label="Notiz Alpha öffnen"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('1 Verweise');
    expect(html).toContain('<details class="memory-transfer"><summary>Import &amp; Export</summary>');
  });

  it('shows the automatic relationship map for saved agent work without an empty manual-note circle', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Test', path: 'synthetic', createdAt: '2026-01-01T00:00:00Z' },
      columns: [],
      cards: [{ id: 'card', projectId: 'p', columnId: 'todo', title: 'Review relay', description: 'Check the bridge', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null }],
      agents: [{ id: 'agent', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
      sessions: [{ id: 'run', projectId: 'p', cardId: 'card', agentId: 'agent', state: 'exited', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T01:00:00Z', exitCode: 0, output: 'Saved result' }],
      workflows: [], notes: [],
    };
    const html = renderToStaticMarkup(createElement(MemoryView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('Beziehungskarte aus Aufgaben und Agentenläufen');
    expect(html).toContain('1 Aufgaben · 1 belegte Läufe');
    expect(html).toContain('Quellen als Liste');
    expect(html).toContain('without-note-graph');
    expect(html).not.toContain('aria-label="Manuelle Notizverknüpfungen"');
  });
});

describe('board view', () => {
  it('renders real snapshot cards and escapes user supplied markup', () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Test', path: 'C:\\test', createdAt: '2026-01-01T00:00:00Z' },
      columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
      cards: [{ id: 'card', projectId: 'p', columnId: 'todo', title: '<script>alert(1)</script>', description: 'Beschreibung', priority: 'none', labels: ['<svg onload=alert(1)>'], position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null }],
      agents: [], sessions: [], workflows: [], notes: [],
    };
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('To Do');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;svg onload=alert(1)&gt;');
    expect(html).not.toContain('<svg onload=alert(1)>');
    expect(html).toContain('Beschreibung');
  });
});
