import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queueStartPreview, startReviewedProjectQueue } from '../../src/main/queue-start-review';
import { setProjectCodexWorkflowAccess } from '../../src/main/project-agent-rights';
import { setCardRunDependencies } from '../../src/main/parallel-runs';
import { StudioStore } from '../../src/main/store';
import { ProjectQueueEngine } from '../../src/main/queue';
import { WorkflowEngine } from '../../src/main/workflows';
import type { SessionRunner } from '../../src/main/cli';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-queue-review-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.agents().find((item) => item.kind === 'codex')!;
  const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template' });
  const queued = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Build UI' });
  const template = store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [templateCard.id],
    steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
  const setState = vi.fn((_input: Parameters<ProjectQueueEngine['setState']>[0]) => store.projectQueue(project.id));
  const engine = { setState } as unknown as ProjectQueueEngine;
  return { store, project, templateCard, queued, template, engine, setState };
}

describe('reviewed project queue start', () => {
  it('rejects a missing or stale review without starting any work', () => {
    const { store, project, queued, template, engine, setState } = fixture();
    const input = { projectId: project.id, state: 'running' as const, templateWorkflowId: template.id, durationHours: 1 as const };
    const review = queueStartPreview(store, input);
    expect(review.token).toMatch(/^[0-9a-f]{64}$/);
    expect(review.candidates.map((item) => item.id)).toEqual([queued.id]);
    expect(() => startReviewedProjectQueue(store, engine, input)).toThrow('review');
    expect(() => startReviewedProjectQueue(store, engine, { ...input, durationHours: 8, reviewToken: review.token })).toThrow('changed');
    expect(() => startReviewedProjectQueue(store, engine, { ...input, runUntil: '2026-12-01T00:00:00.000Z', reviewToken: review.token })).toThrow('duration');
    store.updateCard({ id: queued.id, title: 'Build changed UI' });
    expect(() => startReviewedProjectQueue(store, engine, { ...input, reviewToken: review.token })).toThrow('changed');
    expect(setState).not.toHaveBeenCalled();
    const fresh = queueStartPreview(store, input);
    expect(fresh.token).not.toBe(review.token);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    startReviewedProjectQueue(store, engine, { ...input, reviewToken: fresh.token });
    expect(setState).toHaveBeenCalledOnce();
    expect(setState.mock.calls[0]?.[0]).toMatchObject({ runUntil: '2026-11-26T06:00:00.000Z' });
    store.close();
  });

  it('invalidates a review for an unseen route setting or expanded CLI rights', () => {
    const { store, project, template, engine, setState } = fixture();
    const input = { projectId: project.id, state: 'running' as const, templateWorkflowId: template.id, durationHours: 1 as const };
    const before = queueStartPreview(store, input);
    store.updateDraftWorkflow({ id: template.id, name: template.name, cardIds: template.cardIds,
      steps: template.steps.map((step) => ({ ...step, model: 'different-model' })) });
    expect(() => startReviewedProjectQueue(store, engine, { ...input, reviewToken: before.token })).toThrow('changed');
    const afterRoute = queueStartPreview(store, input);
    setProjectCodexWorkflowAccess(store, { projectId: project.id, mode: 'full', acknowledgeFullAccess: true });
    expect(() => startReviewedProjectQueue(store, engine, { ...input, reviewToken: afterRoute.token })).toThrow('changed');
    expect(queueStartPreview(store, input).codexMode).toBe('full');
    expect(setState).not.toHaveBeenCalled();
    store.close();
  });

  it('rejects a newly added dependency even when the visible queue order is unchanged', () => {
    const { store, project, templateCard, queued, template, engine, setState } = fixture();
    const input = { projectId: project.id, state: 'running' as const, templateWorkflowId: template.id, durationHours: 1 as const };
    const before = queueStartPreview(store, input);
    setCardRunDependencies(store, { cardId: queued.id, prerequisiteCardIds: [templateCard.id] });
    const after = queueStartPreview(store, input);
    expect(after.candidates).toEqual(before.candidates);
    expect(after.token).not.toBe(before.token);
    expect(() => startReviewedProjectQueue(store, engine, { ...input, reviewToken: before.token })).toThrow('changed');
    expect(setState).not.toHaveBeenCalled();
    store.close();
  });

  it('claims exactly the reviewed first card through the real workflow engine', () => {
    const { store, project, queued, template } = fixture();
    const runner = { start: ({ cardId, agentId }: { cardId: string; agentId: string }) => store.createSession({ cardId, agentId }),
      stop: vi.fn() } as unknown as SessionRunner;
    const workflows = new WorkflowEngine(store, runner);
    const engine = new ProjectQueueEngine(store, workflows);
    const preview = queueStartPreview(store, { projectId: project.id, templateWorkflowId: template.id, durationHours: 0 });
    expect(preview.candidates[0]?.id).toBe(queued.id);
    const started = startReviewedProjectQueue(store, engine, { projectId: project.id, state: 'running',
      templateWorkflowId: template.id, durationHours: 0, reviewToken: preview.token });
    expect(started.state).toBe('running');
    expect(started.runUntil).toBeNull();
    expect(store.activeSessionForProject(project.id)?.cardId).toBe(queued.id);
    expect(store.projectQueue(project.id).activeWorkflowId).not.toBeNull();
    engine.dispose();
    store.close();
  });

  it('does not use a new review to restart an already running queue', () => {
    const { store, project, template, engine, setState } = fixture();
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id,
      activeWorkflowId: null, pauseReason: null });
    const preview = queueStartPreview(store, { projectId: project.id, templateWorkflowId: template.id, durationHours: 8 });
    expect(() => startReviewedProjectQueue(store, engine, { projectId: project.id, state: 'running',
      templateWorkflowId: template.id, durationHours: 8, reviewToken: preview.token })).toThrow('already running');
    expect(setState).not.toHaveBeenCalled();
    store.close();
  });

  it('binds an exact deadline to the reviewed start and rejects a changed or expired one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T15:00:00.000Z'));
    const { store, project, template, engine, setState } = fixture();
    const endAt = '2026-11-26T20:00:00.000Z';
    const input = { projectId: project.id, state: 'running' as const, templateWorkflowId: template.id,
      durationHours: 0 as const, endAt };
    const preview = queueStartPreview(store, input);
    expect(preview.endAt).toBe(endAt);
    expect(() => startReviewedProjectQueue(store, engine, { ...input, endAt: '2026-11-26T21:00:00.000Z', reviewToken: preview.token })).toThrow('changed');
    startReviewedProjectQueue(store, engine, { ...input, reviewToken: preview.token });
    expect(setState.mock.calls[0]?.[0]).toMatchObject({ runUntil: endAt });
    vi.setSystemTime(new Date('2026-11-26T20:00:00.000Z'));
    expect(() => queueStartPreview(store, input)).toThrow('deadline');
    store.close();
  });
});
