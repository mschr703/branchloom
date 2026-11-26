import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowView } from '../../src/renderer/components/WorkflowView';
import type { ProjectSnapshot, Workflow } from '../../src/shared/types';

const route: Workflow = {
  id: 'flow', projectId: 'project', name: 'Synthetic route', cardIds: ['card'],
  steps: [{ id: 'step', columnId: 'executing', agentId: 'agent', requireApproval: false }],
  state: 'paused', currentStep: 0, pauseReason: 'review',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetic', path: 'C:\\synthetic', createdAt: route.createdAt },
  columns: [{ id: 'executing', projectId: 'project', name: 'Executing', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [{ id: 'card', projectId: 'project', columnId: 'executing', title: 'Synthetic card', description: '', priority: 'none', labels: [], position: 0, createdAt: route.createdAt, updatedAt: route.updatedAt, archivedAt: null }],
  agents: [{ id: 'agent', name: 'Synthetic agent', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [], workflows: [route], notes: [],
  queue: { projectId: 'project', state: 'paused', templateWorkflowId: route.id, activeWorkflowId: route.id, pauseReason: 'Schritt prüfen', completedCount: 0, updatedAt: route.updatedAt },
};
const mutate = async <T,>(action: () => Promise<T>): Promise<T> => action();

describe('queue recovery view', () => {
  it('shows the continuation choice only as editable while the queue is stopped', () => {
    const paused = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, queue: { ...snapshot.queue, continueBlocked: true } }, mutate }));
    expect(paused).toMatch(/type="checkbox" checked=""/u);
    expect(paused).toContain('Bei blockierten Karten mit anderen Aufgaben weitermachen');
    const running = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, queue: { ...snapshot.queue, state: 'running', continueBlocked: true } }, mutate }));
    const control = running.match(/<input[^>]*type="checkbox"[^>]*>/u)?.[0];
    expect(control).toContain('checked=""');
    expect(control).toContain('disabled=""');
  });
  it('disables activation and explains the missing To-Do column', () => {
    const inactive = { ...snapshot, queue: { ...snapshot.queue, state: 'off' as const, activeWorkflowId: null } };
    const html = renderToStaticMarkup(createElement(WorkflowView, { snapshot: inactive, mutate }));
    expect(html).toContain('braucht dieses Board eine Spalte namens To Do');
    expect(html.slice(0, html.indexOf('Queue aktivieren')).slice(-700)).toContain('disabled=""');
  });

  it('offers a deliberate skip only for a paused active queue workflow', () => {
    const paused = renderToStaticMarkup(createElement(WorkflowView, { snapshot, mutate }));
    expect(paused).toContain('Aktive Karte überspringen');
    expect(paused).toContain('Die nächste Karte startet erst nach ausdrücklichem');
    const running = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, queue: { ...snapshot.queue, state: 'running' }, workflows: [{ ...route, state: 'running' }] }, mutate }));
    expect(running).not.toContain('Aktive Karte überspringen');
  });

  it('shows a pending spawn-only retry and keeps the pause control available', () => {
    const html = renderToStaticMarkup(createElement(WorkflowView, { snapshot: {
      ...snapshot, queue: { ...snapshot.queue, state: 'running', pauseReason: 'CLI-Start vor Prozessbeginn fehlgeschlagen (1/2 automatische Wiederholungen). Nächster Versuch 03:15:00.' },
    }, mutate }));
    expect(html).toContain('vor Prozessbeginn fehlgeschlagen');
    expect(html).toContain('Nächster Versuch 03:15:00');
    expect(html).toContain('Queue pausieren');
    expect(html).not.toContain('Aktive Karte überspringen');
  });

  it('shows the audited skip and removes the workflow restart action', () => {
    const skipped = { ...route, queueSkip: { reason: '<blocked>', at: route.updatedAt } };
    const html = renderToStaticMarkup(createElement(WorkflowView, { snapshot: { ...snapshot, queue: { ...snapshot.queue, activeWorkflowId: null }, workflows: [skipped] }, mutate }));
    expect(html).toContain('Übersprungen');
    expect(html).toContain('&lt;blocked&gt;');
    expect(html).not.toContain('Schritt erneut starten');
    expect(html).not.toContain('Aktive Karte überspringen');
  });
});
