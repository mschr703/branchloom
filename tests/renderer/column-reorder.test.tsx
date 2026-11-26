import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BoardView, ColumnAgentSettings } from '../../src/renderer/components/BoardView';
import { ColumnSettingsSheet } from '../../src/renderer/components/ColumnSettingsSheet';
import type { Column, ProjectSnapshot } from '../../src/shared/types';

const stamp = '2026-01-01T00:00:00Z';
const mutate = async <T,>(action: () => Promise<T>): Promise<T> => action();
const snapshot: ProjectSnapshot = {
  project: { id: 'p', name: 'Synthetic', path: 'C:\\synthetic', createdAt: stamp },
  columns: [
    { id: 'second', projectId: 'p', name: 'Später', position: 1, agentId: null, model: null, effort: null, autoStart: false },
    { id: 'first', projectId: 'p', name: 'Zuerst', position: 0, agentId: null, model: null, effort: null, autoStart: false },
  ],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};

function renderSheet(current: ProjectSnapshot, column: Column, deleteReason = ''): string {
  return renderToStaticMarkup(<ColumnSettingsSheet column={column} columns={[...current.columns].sort((a, b) => a.position - b.position)} snapshot={current} mutate={mutate} onClose={() => undefined} onSelectCard={() => undefined} onReorderColumn={async () => undefined} renameLocked={column.name === 'To Do' && current.queue.state !== 'off'} deleteReason={deleteReason}><ColumnAgentSettings column={column} agents={current.agents} mutate={mutate} /></ColumnSettingsSheet>);
}

describe('board column settings', () => {
  it('keeps the header trigger and add action visible while settings live in a sheet', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate }));
    expect(html.indexOf('Spalte Zuerst')).toBeLessThan(html.indexOf('Spalte Später'));
    expect(html).toContain('aria-label="Spalte Zuerst einstellen"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Karte in Zuerst hinzufügen"');
    expect(html).not.toContain('column-agent-details');
    const settings = renderSheet(snapshot, snapshot.columns[1]!);
    expect(settings).toContain('role="dialog"');
    expect(settings).toContain('aria-label="Spalte Zuerst nach links verschieben"');
    expect(settings).toContain('title="Erste Spalte"');
    expect(settings).toContain('aria-label="Spalte Zuerst nach rechts verschieben"');
    expect(settings).toContain('aria-label="Agent für Zuerst"');
    expect(settings).toContain('aria-label="Farbe für Spalte Zuerst"');
    expect(settings).toContain('Koralle für Spalte Zuerst');
    expect(settings).toContain('Agent beim Verschieben in diese Spalte automatisch starten');
  });

  it('marks the saved board tint in both the column and its settings', () => {
    const tinted = { ...snapshot.columns[1]!, tint: 'coral' as const };
    const current = { ...snapshot, columns: [snapshot.columns[0]!, tinted] };
    const board = renderToStaticMarkup(createElement(BoardView, { snapshot: current, mutate }));
    expect(board).toContain('data-tint="coral"');
    const settings = renderSheet(current, tinted);
    expect(settings).toMatch(/data-tint="coral"[^>]*aria-label="Koralle für Spalte Zuerst"[^>]*aria-pressed="true"/);
  });

  it('explains a locked To Do name and a blocked deletion', () => {
    const todo = { ...snapshot.columns[1]!, name: 'To Do' };
    const paused = { ...snapshot, columns: [snapshot.columns[0]!, todo], queue: { ...snapshot.queue, state: 'paused' as const } };
    const html = renderSheet(paused, todo, 'Spalte enthält aktive oder archivierte Karten');
    expect(html).toContain('To Do kann erst nach Ausschalten der Warteschlange umbenannt werden.');
    expect(html).toContain('Spalte enthält aktive oder archivierte Karten');
    expect(html).toMatch(/<button[^>]*(?=[^>]*disabled="")(?=[^>]*aria-label="Spalte To Do löschen")[^>]*>/);
  });

  it('only lists real sessions of cards currently in the selected column', () => {
    const first = snapshot.columns[1]!;
    const second = snapshot.columns[0]!;
    const card = { id: 'card', projectId: 'p', columnId: first.id, title: 'Draft', description: '', priority: 'none' as const, labels: [], wireframeRequired: false, position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: null };
    const elsewhere = { ...card, id: 'other', columnId: second.id, title: 'Other' };
    const current = { ...snapshot, cards: [card, elsewhere], sessions: [
      { id: 'run', projectId: 'p', cardId: card.id, agentId: 'codex', state: 'running' as const, startedAt: stamp, endedAt: null, exitCode: null, output: '' },
      { id: 'other-run', projectId: 'p', cardId: elsewhere.id, agentId: 'codex', state: 'exited' as const, startedAt: stamp, endedAt: stamp, exitCode: 0, output: '' },
    ] };
    const html = renderSheet(current, first, 'Spalte enthält aktive oder archivierte Karten');
    expect(html).toContain('Sitzungen aktueller Karten');
    expect(html).toContain('Draft');
    expect(html).toContain('Läuft');
    expect(html).not.toContain('Other');
  });

  it('shows board search, priority and label filters before advanced options', () => {
    const html = renderToStaticMarkup(createElement(BoardView, { snapshot, mutate }));
    expect(html).toContain('aria-label="Karten suchen"');
    expect(html.indexOf('aria-label="Priorität filtern"')).toBeLessThan(html.indexOf('<details class="board-filter-options"'));
    expect(html.indexOf('aria-label="Label filtern"')).toBeLessThan(html.indexOf('<details class="board-filter-options"'));
    expect(html).toContain('<summary>Weitere Filter</summary>');
    expect(html).toContain('aria-label="Spalte filtern"');
    expect(html).toContain('aria-label="Archivstatus filtern"');
  });
});
