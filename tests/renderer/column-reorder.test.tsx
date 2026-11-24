import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardView } from '../../src/renderer/components/BoardView';
import type { ProjectSnapshot } from '../../src/shared/types';

const stamp = '2026-01-01T00:00:00Z';
const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Synthetic', path: 'C:\synthetic', createdAt: stamp },
  columns: [
    { id: 'second', projectId: 'p', name: 'Später', position: 1, agentId: null, model: null, effort: null, autoStart: false },
    { id: 'first', projectId: 'p', name: 'Zuerst', position: 0, agentId: null, model: null, effort: null, autoStart: false },
  ],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};

describe('board column order controls', () => {
  it('renders sorted columns with an unavailable edge control', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html.indexOf('Spalte Zuerst')).toBeLessThan(html.indexOf('Spalte Später'));
    expect(html).toContain('aria-label="Spalte Zuerst nach links verschieben"');
    expect(html).toContain('aria-label="Spalte Später nach rechts verschieben"');
    expect(html).toContain('title="Erste Spalte"');
    expect(html).toContain('title="Letzte Spalte"');
    expect(html).toContain('aria-label="Spalte Zuerst umbenennen"');
    expect(html).toContain('aria-label="Spalte Zuerst einstellen"');
    expect(html).toContain('aria-label="Karte in Zuerst hinzufügen"');
    expect(html).toContain('Aufgabe hinzufügen');
  });

  it('disables the To-Do rename control while the queue is paused', () => {
    const todo = { ...snapshot.columns[1]!, name: 'To Do' };
    const paused = { ...snapshot, columns: [snapshot.columns[0]!, todo], queue: { ...snapshot.queue, state: 'paused' as const } };
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot: paused, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('To-Do-Spalte erst nach Ausschalten der Warteschlange umbenennen');
  });

  it('offers deletion only when a column is empty and unreferenced', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('aria-label="Spalte Später löschen"');
    expect(html).toContain('title="Leere Spalte löschen"');
    const withCard = { ...snapshot, cards: [{ id: 'card', projectId: 'p', columnId: 'second', title: 'Archived', description: '', priority: 'none' as const, labels: [], position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: stamp }] };
    const blocked = renderToStaticMarkup(createElement(BoardView, { snapshot: withCard, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(blocked).toContain('Spalte enthält aktive oder archivierte Karten');
  });

  it('keeps the agent form reachable while collapsing it below each board column', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('<details class="column-agent-details"><summary>Spaltenagent <span>Nicht zugewiesen</span></summary>');
    expect(html).toContain('aria-label="Agent für Zuerst"');
    expect(html).toContain('Agent automatisch starten');
    expect(html).not.toContain('<details class="column-agent-details" open=""');
  });

  it('keeps advanced board filters available behind one disclosure', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() }));
    expect(html).toContain('<details class="board-filter-options"><summary>Filter</summary>');
    expect(html).toContain('aria-label="Spalte filtern"');
    expect(html).toContain('aria-label="Archivstatus filtern"');
    expect(html).toContain('Aufgabe vorbereiten');
  });
});
