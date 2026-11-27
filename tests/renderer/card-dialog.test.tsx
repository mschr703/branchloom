import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardPanel } from '../../src/renderer/components/CardPanel';
import type { Card, ProjectSnapshot } from '../../src/shared/types';

const stamp = '2026-01-01T00:00:00.000Z';
const card: Card = { id: 'synthetic-card', projectId: 'project', columnId: 'todo', title: 'Accessible card', description: '', priority: 'none', labels: [], position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: null };
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetic', path: 'C:\\synthetic', createdAt: stamp },
  columns: [{ id: 'todo', projectId: 'project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [card], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};

describe('card dialog accessibility', () => {
  it('labels the modal with the actual card heading and keeps an explicit close control', () => {
    const html = renderToStaticMarkup(createElement(CardPanel, { card, snapshot, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined, onOpenCard: () => undefined }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="card-dialog-title-synthetic-card"');
    expect(html).toContain('<h2 id="card-dialog-title-synthetic-card">Accessible card</h2>');
    expect(html).toContain('aria-label="Karte schließen"');
    expect(html).toContain('Karte löschen');
    expect(html).toContain('<summary>Planung, Kontext und Nachweise</summary>');
    expect(html).toContain('Für diese Spalte ist kein Agent eingestellt');
    expect(html).toContain('Fehlerabläufe ansehen</button>');
    expect(html).toContain('aria-label="Gespeicherte Fehlerabläufe" tabindex="-1"');
    expect(html.indexOf('class="text-button card-replay-jump"')).toBeLessThan(html.indexOf('aria-label="Karte schließen"'));
    expect(html).toContain('aria-label="Integrationswarteschlange"');
    expect(html).toContain('Integrationsliste wird geladen');
    expect(html).not.toContain('Fast-Forward bestätigt übernehmen');
  });

  it('explains when a card run inherits its column agent and keeps changing it optional', () => {
    const withAgent: ProjectSnapshot = {
      ...snapshot,
      columns: [{ ...snapshot.columns[0]!, agentId: 'agent' }],
      agents: [{ id: 'agent', name: 'Synthetic CLI', kind: 'custom', command: 'synthetic', args: [], model: null, enabled: true }],
    };
    const html = renderToStaticMarkup(createElement(CardPanel, { card, snapshot: withAgent, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined, onOpenCard: () => undefined }));
    expect(html).toContain('ist Synthetic CLI eingestellt');
    expect(html).toContain('<summary>Agent wechseln · aktuell Synthetic CLI</summary>');
    expect(html).toContain('Agent nur für diesen Start');
  });

  it('shows a reached workflow haltpoint beside the affected card session history', () => {
    const withHaltpoint: ProjectSnapshot = { ...snapshot, workflows: [{
      id: 'flow', projectId: card.projectId, name: 'Synthetic route', cardIds: [card.id],
      steps: [{ id: 'one', columnId: 'todo', agentId: null, requireApproval: false }, { id: 'two', columnId: 'todo', agentId: null, requireApproval: false }],
      state: 'paused', currentStep: 1, pauseReason: 'haltpoint',
      haltpoint: { id: 'halt', afterStepIndex: 0, stepId: 'one', state: 'reached', requestedAt: stamp, reachedAt: stamp },
      createdAt: stamp, updatedAt: stamp,
    }] };
    const html = renderToStaticMarkup(createElement(CardPanel, { card, snapshot: withHaltpoint, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined, onOpenCard: () => undefined }));
    expect(html).toContain('Synthetic route:</strong> Haltepunkt nach Schritt 1 erreicht');
    expect(html).toContain('Der nächste Agentenlauf wartet auf Fortsetzung');
  });
});
