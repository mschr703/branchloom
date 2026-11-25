// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { ProjectSnapshot, Workflow } from '../../src/shared/types';
import type { WorkflowRunEvidence } from '../../src/shared/workflow-evidence';
import { cardWorkflowSignal } from '../../src/renderer/board-workflow-signals';
import { BoardWorkflowMarkers } from '../../src/renderer/components/BoardWorkflowMarkers';
import { BoardView } from '../../src/renderer/components/BoardView';

const workflow: Workflow = {
  id: 'workflow', projectId: 'project', name: 'Build and review', cardIds: ['card'], state: 'running', currentStep: 3,
  steps: [0, 1, 2, 3].map((index) => ({ id: `step-${index}`, columnId: `column-${index}`, agentId: null, requireApproval: false })),
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T01:00:00Z',
};
const evidence: WorkflowRunEvidence = {
  projectId: 'project', workflowId: 'workflow', moreAvailable: false,
  rows: [
    { stepIndex: 0, cardId: 'card', cardTitle: 'Task', state: 'complete', session: null, missingSession: false },
    { stepIndex: 1, cardId: 'card', cardTitle: 'Task', state: 'needs_review', session: null, missingSession: false },
    { stepIndex: 2, cardId: 'card', cardTitle: 'Task', state: 'pending', session: null, missingSession: false },
  ],
};

it('renders only stored per-card step progress, with an explicit missing-evidence state', () => {
  const signal = cardWorkflowSignal('card', [workflow], { workflow: evidence });
  expect(signal?.states).toEqual(['complete', 'needs_review', 'pending', 'not-recorded']);
  expect(signal?.summary).toContain('1 von 4 Schritten als abgeschlossen gespeichert');
  expect(signal?.summary).toContain('Schritt 4 noch ohne Laufbeleg');
  const html = renderToStaticMarkup(<BoardWorkflowMarkers cardId="card" signal={signal!} />);
  expect(html).toContain('1/4');
  expect(html).toContain('needs_review');
  expect(html).toContain('Build and review');
});

it('does not turn a route index, unrelated row, or truncated evidence into a progress signal', () => {
  const other = { ...evidence, rows: evidence.rows.map((row) => ({ ...row, cardId: 'other' })) };
  expect(cardWorkflowSignal('card', [workflow], { workflow: other })).toBeNull();
  expect(cardWorkflowSignal('card', [workflow], { workflow: { ...evidence, moreAvailable: true } })).toBeNull();
  expect(cardWorkflowSignal('card', [{ ...workflow, state: 'draft' }], { workflow: evidence })).toBeNull();
});

it('loads recorded progress through the Board API and offers retry after a failed refresh', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const workflowRunEvidence = vi.fn().mockResolvedValue(evidence);
  Object.defineProperty(window, 'studio', { configurable: true, value: { workflowRunEvidence } });
  const snapshot = {
    project: { id: 'project', name: 'Sample', path: 'C:\\sample', createdAt: '2026-01-01T00:00:00Z' },
    columns: [{ id: 'column-0', projectId: 'project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
    cards: [{ id: 'card', projectId: 'project', columnId: 'column-0', title: 'Task', description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null }],
    agents: [], sessions: [], workflows: [workflow], notes: [],
    queue: { projectId: 'project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
    runPause: { projectId: 'project', paused: false, reason: null, updatedAt: null },
  } as ProjectSnapshot;
  try {
    await act(async () => { root.render(<BoardView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} />); });
    expect(workflowRunEvidence).toHaveBeenCalledWith({ projectId: 'project', workflowId: 'workflow' });
    expect(host.querySelector('.board-workflow-signal')?.textContent).toContain('1/4');

    workflowRunEvidence.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => { root.render(<BoardView snapshot={{ ...snapshot, workflows: [{ ...workflow, updatedAt: '2026-01-01T02:00:00Z' }] }} mutate={async <T,>(action: () => Promise<T>) => action()} />); });
    expect(host.querySelector('.board-workflow-signal')).toBeNull();
    expect(host.textContent).toContain('Workflow-Verlauf nicht vollständig geladen');

    await act(async () => { host.querySelector<HTMLButtonElement>('.board-workflow-error button')!.click(); });
    expect(host.querySelector('.board-workflow-signal')?.textContent).toContain('1/4');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});
