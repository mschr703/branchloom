// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueueStartPreview, queueStartReview } from '../../src/renderer/components/QueueStartPreview';
import { WorkflowView } from '../../src/renderer/components/WorkflowView';
import type { ProjectSnapshot, Workflow } from '../../src/shared/types';

const route: Workflow = { id: 'route', projectId: 'project', name: 'Implementation route', cardIds: ['card'],
  steps: [{ id: 'execute', columnId: 'execute', agentId: 'agent', requireApproval: false }],
  state: 'draft', currentStep: 0, createdAt: '2026-11-26T01:00:00.000Z', updatedAt: '2026-11-26T01:00:00.000Z' };
const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetic project', path: 'C:\\synthetic', createdAt: route.createdAt },
  columns: [{ id: 'execute', projectId: 'project', name: 'Executing', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [], agents: [{ id: 'agent', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true }],
  sessions: [], workflows: [route], notes: [],
  queue: { projectId: 'project', state: 'off', templateWorkflowId: route.id, activeWorkflowId: null,
    pauseReason: null, completedCount: 0, updatedAt: null, continueBlocked: true, autoResumeIdle: false, runUntil: null },
};
const candidate = { id: 'card', projectId: 'project', columnId: 'execute', title: 'Build login', description: '',
  priority: 'none' as const, labels: [], position: 0, createdAt: route.createdAt, updatedAt: route.updatedAt, archivedAt: null };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove(); host = null;
  vi.unstubAllGlobals();
});

function button(text: string): HTMLButtonElement {
  const found = [...(host?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(text));
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}

async function mount(mode: () => 'workspace' | 'full', start = vi.fn(async () => snapshot.queue), onClose = vi.fn()) {
  const studio = {
    snapshot: vi.fn(async () => snapshot), queueCandidates: vi.fn(async () => [candidate]),
    projectCodexWorkflowAccess: vi.fn(async () => ({ projectId: 'project', mode: mode() })),
    integrationPolicy: vi.fn(async () => ({ projectId: 'project', mode: 'manual' as const, updatedAt: null })),
    setProjectQueue: start,
  };
  vi.stubGlobal('studio', studio);
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<QueueStartPreview projectId="project" templateId="route" hours={1}
    mutate={async <T,>(action: () => Promise<T>) => action()} onClose={onClose} />));
  return studio;
}

describe('queue start preview', () => {
  it('does not present Codex rights as active for a route without Codex', () => {
    const manual = { ...route, steps: [{ ...route.steps[0]!, agentId: null }] };
    const review = queueStartReview({ ...snapshot, workflows: [manual] }, route.id, [candidate],
      { projectId: 'project', mode: 'full' }, { projectId: 'project', mode: 'manual', updatedAt: null });
    expect(review.route.usesCodex).toBe(false);
  });

  it('shows current rights and planned scope before starting the queue', async () => {
    const studio = await mount(() => 'workspace');
    expect(host?.textContent).toContain('Synthetic project');
    expect(host?.textContent).toContain('Executing · Codex');
    expect(host?.textContent).toContain('Build login');
    expect(host?.textContent).toContain('Projektmodus');
    expect(host?.textContent).toContain('Integration bleibt manuell');
    expect(studio.setProjectQueue).not.toHaveBeenCalled();
    await act(async () => button('Queue starten').click());
    expect(studio.setProjectQueue).toHaveBeenCalledOnce();
    expect(studio.setProjectQueue.mock.calls[0]?.[0]).toMatchObject({ projectId: 'project', state: 'running', templateWorkflowId: 'route' });
  });

  it('requires another click when access changes while the preview is open', async () => {
    let mode: 'workspace' | 'full' = 'workspace';
    const studio = await mount(() => mode);
    mode = 'full';
    await act(async () => button('Queue starten').click());
    expect(studio.setProjectQueue).not.toHaveBeenCalled();
    expect(host?.textContent).toContain('Projekt, Route oder Einstellungen haben sich geändert');
    expect(host?.textContent).toContain('Voller CLI-Zugriff');
    await act(async () => button('Queue starten').click());
    expect(studio.setProjectQueue).toHaveBeenCalledOnce();
  });

  it('keeps the dialog open and reports a rejected start', async () => {
    await mount(() => 'workspace', vi.fn(async () => { throw new Error('Queue is offline'); }));
    await act(async () => button('Queue starten').click());
    expect(host?.getAttribute('role')).toBeNull();
    expect(host?.querySelector('[role="dialog"]')).not.toBeNull();
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('Queue is offline');
  });

  it('lets the user reload a failed rights check before starting', async () => {
    let attempts = 0;
    const studio = await mount(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('Rights unavailable');
      return 'workspace';
    });
    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('Rights unavailable');
    expect(button('Queue starten').disabled).toBe(true);
    await act(async () => button('Erneut laden').click());
    expect(host?.textContent).toContain('Codex: Projektmodus');
    expect(studio.setProjectQueue).not.toHaveBeenCalled();
  });

  it('closes with Escape without starting the queue', async () => {
    const onClose = vi.fn();
    const studio = await mount(() => 'workspace', vi.fn(async () => snapshot.queue), onClose);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(studio.setProjectQueue).not.toHaveBeenCalled();
  });

  it('keeps keyboard focus within the start review', async () => {
    await mount(() => 'workspace');
    button('Queue starten').focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(host?.querySelector('[aria-label="Schließen"]'));
  });

  it('opens the review from the workflow page before any queue start', async () => {
    const todo = { ...snapshot.columns[0]!, id: 'todo', name: 'To Do', position: -1 };
    const board = { ...snapshot, columns: [todo, ...snapshot.columns], cards: [{ ...candidate, columnId: 'todo' }] };
    const start = vi.fn(async () => snapshot.queue);
    vi.stubGlobal('studio', {
      snapshot: vi.fn(async () => board), queueCandidates: vi.fn(async () => [{ ...candidate, columnId: 'todo' }]),
      projectCodexWorkflowAccess: vi.fn(async () => ({ projectId: 'project', mode: 'workspace' })),
      integrationPolicy: vi.fn(async () => ({ projectId: 'project', mode: 'manual', updatedAt: null })),
      setProjectQueue: start, queueResults: vi.fn(async () => ({ projectId: 'project', total: 0, truncated: false,
        counts: { done: 0, 'needs-attention': 0, running: 0, skipped: 0, pending: 0 }, items: [], latestActivation: null,
        latestItems: [], latestTruncated: false })),
      workflowAgentSettings: vi.fn(async () => ({ agentId: null, model: null, effort: null })),
      detectAgents: vi.fn(async () => []), reviewedPlans: vi.fn(async () => []), reviewRules: vi.fn(async () => []),
    });
    host = document.createElement('div'); document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<WorkflowView snapshot={board} mutate={async <T,>(action: () => Promise<T>) => action()} />));
    await act(async () => button('Queue aktivieren').click());
    expect(host?.textContent).toContain('Projektlauf prüfen');
    expect(start).not.toHaveBeenCalled();
    await act(async () => button('Queue starten').click());
    expect(start).toHaveBeenCalledOnce();
  });
});
