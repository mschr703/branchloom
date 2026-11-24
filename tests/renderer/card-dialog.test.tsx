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
    expect(html).toContain('aria-label="Integrationswarteschlange"');
    expect(html).toContain('Integrationsliste wird geladen');
    expect(html).not.toContain('Fast-Forward bestätigt übernehmen');
  });
});
