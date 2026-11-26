import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../../src/shared/types';
import { AgentSpawnError, DONE_MARKER, type SessionRunner } from '../../src/main/cli';
import { ProjectQueueEngine } from '../../src/main/queue';
import { setCardRunDependencies } from '../../src/main/parallel-runs';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '')) throw error;
    }
  }
});

function fixture(spawnFailures = 0, failureKind: 'spawn' | 'other' = 'spawn') {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-queue-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.agents().find((item) => item.kind === 'codex')!;
  const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template only' });
  const first = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'First queued' });
  const second = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Second queued' });
  const template = store.createWorkflow({ projectId: project.id, name: 'Implement route', cardIds: [templateCard.id], steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
  const started: Session[] = [];
  const attempts: Session[] = [];
  const stopped: string[] = [];
  const runner = {
    start: ({ cardId, agentId }: { cardId: string; agentId: string }) => {
      const session = store.createSession({ cardId, agentId });
      attempts.push(session);
      if (attempts.length <= spawnFailures) {
        store.finishSession(session.id, 'failed', null);
        if (failureKind === 'spawn') throw new AgentSpawnError('Synthetische PTY-Startausnahme');
        throw new Error('Synthetischer Konfigurationsfehler vor dem PTY-Start');
      }
      started.push(session);
      return session;
    },
    stop: (id: string) => { stopped.push(id); store.finishSession(id, 'stopped', null); },
  } as unknown as SessionRunner;
  const workflows = new WorkflowEngine(store, runner);
  const queue = new ProjectQueueEngine(store, workflows);
  return { store, dbPath, project, columns, template, first, second, started, attempts, stopped, workflows, queue };
}

describe('explicit durable project queue', () => {
  it('retries only a proven synchronous PTY spawn error twice, with persisted delay and no duplicate claim', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T02:00:00.000Z'));
    const { store, project, template, first, started, attempts, queue } = fixture(2);
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId;
    expect(attempts).toHaveLength(1);
    expect(started).toHaveLength(0);
    expect(store.queueLaunchRetry(project.id)).toMatchObject({ workflowId: activeId, attemptCount: 1, retryAt: '2026-11-24T02:00:05.000Z' });
    expect(store.projectQueue(project.id).pauseReason).toContain('vor Prozessbeginn');
    queue.onBoardChanged(project.id);
    queue.onBoardChanged(project.id);
    expect(attempts).toHaveLength(1);
    vi.advanceTimersByTime(5_000);
    expect(attempts).toHaveLength(2);
    expect(store.queueLaunchRetry(project.id)).toMatchObject({ workflowId: activeId, attemptCount: 2, retryAt: '2026-11-24T02:00:25.000Z' });
    vi.advanceTimersByTime(20_000);
    expect(attempts).toHaveLength(3);
    expect(started.map((session) => session.cardId)).toEqual([first.id]);
    expect(new Set(attempts.map((session) => session.cardId))).toEqual(new Set([first.id]));
    expect(store.projectQueue(project.id).activeWorkflowId).toBe(activeId);
    expect(store.queueLaunchRetry(project.id)).toBeNull();
    expect(store.projectQueue(project.id).pauseReason).toBeNull();
    expect(store.snapshot(project.id).sessions.filter((session) => session.state === 'running')).toHaveLength(1);
    queue.dispose();
    store.close();
  });

  it('cancels a pending launch retry on pause and never replays it after restart', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T02:00:00.000Z'));
    const { store, dbPath, project, template, attempts, queue } = fixture(2);
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(store.queueLaunchRetry(project.id)?.attemptCount).toBe(1);
    queue.setState({ projectId: project.id, state: 'paused' });
    vi.advanceTimersByTime(60_000);
    expect(attempts).toHaveLength(1);
    expect(store.queueLaunchRetry(project.id)).toBeNull();
    queue.dispose();
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    reopened.close();
  });

  it('stops after two automatic retries and keeps the claimed card for review', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T02:00:00.000Z'));
    const { store, project, template, first, attempts, queue } = fixture(3);
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    vi.advanceTimersByTime(25_000);
    expect(attempts).toHaveLength(3);
    expect(store.projectQueue(project.id).state).toBe('paused');
    expect(store.projectQueue(project.id).pauseReason).toContain('dreimal fehlgeschlagen');
    expect(store.queueLaunchRetry(project.id)).toBeNull();
    expect(store.workflow(store.projectQueue(project.id).activeWorkflowId!).state).toBe('paused');
    expect(store.nextQueueCard(project.id)?.id).not.toBe(first.id);
    vi.advanceTimersByTime(60_000);
    expect(attempts).toHaveLength(3);
    queue.dispose();
    store.close();
  });

  it('does not retry a configuration error outside the typed PTY spawn boundary', () => {
    vi.useFakeTimers();
    const { store, project, template, attempts, queue } = fixture(2, 'other');
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(store.projectQueue(project.id).state).toBe('paused');
    expect(store.projectQueue(project.id).pauseReason).toContain('Konfigurationsfehler');
    expect(store.queueLaunchRetry(project.id)).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(attempts).toHaveLength(1);
    queue.dispose();
    store.close();
  });

  it('marks an interrupted pending retry for review without starting it on app reopen', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-24T02:00:00.000Z'));
    const { store, dbPath, project, template, attempts, queue } = fixture(2);
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    queue.dispose();
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    expect(reopened.projectQueue(project.id).pauseReason).toContain('CLI-Startfehlers');
    expect(reopened.queueLaunchRetry(project.id)).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(attempts).toHaveLength(1);
    reopened.close();
  });
  it('rejects activation without a To-Do column and leaves the queue off', () => {
    const { store, project, columns, template, queue } = fixture();
    store.updateColumn({ id: columns[0]!.id, name: 'Inbox' });
    expect(() => queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id })).toThrow('To-Do-Spalte');
    expect(store.projectQueue(project.id).state).toBe('off');
    store.close();
  });

  it('previews exactly the eligible cards in the same order used for the next claim', () => {
    const { store, project, template, first, second, queue } = fixture();
    expect(store.queueCandidates(project.id).map((card) => card.id)).toEqual([first.id, second.id]);
    expect(store.queueCandidates(project.id, 1).map((card) => card.id)).toEqual([first.id]);
    expect(() => store.queueCandidates(project.id, 21)).toThrow('Vorschaugröße');
    store.reorderCard({ id: second.id, direction: 'up' });
    expect(store.queueCandidates(project.id).map((card) => card.id)).toEqual([second.id, first.id]);
    expect(store.nextQueueCard(project.id)?.id).toBe(second.id);
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(store.queueCandidates(project.id).map((card) => card.id)).toEqual([first.id]);
    store.close();
  });

  it('claims the user-reordered To-Do card first without starting on the reorder itself', () => {
    const { store, project, template, first, second, started, queue } = fixture();
    store.reorderCard({ id: second.id, direction: 'up' });
    expect(store.nextQueueCard(project.id)?.id).toBe(second.id);
    expect(started).toHaveLength(0);
    expect(store.projectQueue(project.id).state).toBe('off');
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(started.map((session) => session.cardId)).toEqual([second.id]);
    expect(store.card(first.id).columnId).toBe(store.snapshot(project.id).columns[0]?.id);
    store.close();
  });

  it('is off by default, requires a route and processes one free To-Do card at a time', () => {
    const { store, project, template, first, second, started, workflows, queue } = fixture();
    expect(store.projectQueue(project.id).state).toBe('off');
    expect(() => queue.setState({ projectId: project.id, state: 'running' })).toThrow('Vorlage');
    const active = queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(active.state).toBe('running');
    expect(started).toHaveLength(1);
    expect(started[0]?.cardId).toBe(first.id);
    expect(store.projectQueue(project.id).activeWorkflowId).not.toBe(template.id);
    expect(store.card(first.id).columnId).toBe(store.snapshot(project.id).columns[2]?.id);
    store.appendOutput(started[0]!.id, `Done\n${DONE_MARKER}`);
    const finished = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(finished, `Done\n${DONE_MARKER}`);
    queue.onSessionFinished(finished);
    expect(started).toHaveLength(2);
    expect(started[1]?.cardId).toBe(second.id);
    expect(store.projectQueue(project.id).completedCount).toBe(1);
    expect(store.snapshot(project.id).sessions.filter((item) => item.state === 'running')).toHaveLength(1);
    store.close();
  });

  it('pauses on a missing completion gate and never starts the next card automatically', () => {
    const { store, project, template, started, workflows, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const finished = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(finished, 'No verified completion');
    queue.onSessionFinished(finished);
    expect(store.projectQueue(project.id).state).toBe('paused');
    expect(store.projectQueue(project.id).pauseReason).toContain('prüfen');
    expect(store.queueLaunchRetry(project.id)).toBeNull();
    expect(started).toHaveLength(1);
    expect(() => queue.setState({ projectId: project.id, state: 'running' })).toThrow('nicht selbst erneut');
    store.close();
  });

  it('keeps the continuation policy off by default and persists an explicit choice', () => {
    const { store, dbPath, project, template, queue } = fixture();
    expect(store.projectQueue(project.id).continueBlocked).toBe(false);
    expect(store.setQueueContinueBlocked({ projectId: project.id, enabled: true }).continueBlocked).toBe(true);
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(() => store.setQueueContinueBlocked({ projectId: project.id, enabled: false })).toThrow('Pause the queue');
    queue.setState({ projectId: project.id, state: 'paused' });
    expect(store.projectQueue(project.id).continueBlocked).toBe(true);
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.projectQueue(project.id)).toMatchObject({ state: 'paused', continueBlocked: true });
    reopened.setQueueContinueBlocked({ projectId: project.id, enabled: false });
    expect(reopened.projectQueue(project.id).continueBlocked).toBe(false);
    reopened.close();
  });

  it('records a blocked run and starts an independent next card without replaying the failed one', () => {
    const { store, dbPath, project, template, first, second, started, workflows, queue } = fixture();
    store.setQueueContinueBlocked({ projectId: project.id, enabled: true });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const firstFlowId = store.projectQueue(project.id).activeWorkflowId!;
    const failed = store.finishSession(started[0]!.id, 'failed', 1);
    workflows.onSessionFinished(failed, 'Agent could not finish');
    queue.onSessionFinished(failed);
    expect(started.map((session) => session.cardId)).toEqual([first.id, second.id]);
    expect(store.workflow(firstFlowId)).toMatchObject({ state: 'paused', queueSkip: { reason: expect.stringContaining('Automatisch') } });
    expect(store.projectQueue(project.id)).toMatchObject({ state: 'running', completedCount: 0, continueBlocked: true });
    expect(() => workflows.setState({ id: firstFlowId, state: 'running' })).toThrow('übersprungen');
    queue.setState({ projectId: project.id, state: 'paused' });
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(firstFlowId).queueSkip?.reason).toContain('Automatisch');
    expect(reopened.projectQueue(project.id).continueBlocked).toBe(true);
    expect(reopened.snapshot(project.id).sessions.filter((session) => session.cardId === first.id)).toHaveLength(1);
    reopened.close();
  });

  it('passes blocked dependent cards to start later independent work beyond the preview limit', () => {
    const { store, project, columns, template, first, second, started, workflows, queue } = fixture();
    store.setQueueContinueBlocked({ projectId: project.id, enabled: true });
    setCardRunDependencies(store, { cardId: second.id, prerequisiteCardIds: [first.id] });
    for (let index = 0; index < 20; index += 1) {
      const dependent = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: `Dependent ${index}` });
      setCardRunDependencies(store, { cardId: dependent.id, prerequisiteCardIds: [first.id] });
    }
    const independent = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Independent next' });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const failed = store.finishSession(started[0]!.id, 'failed', 1);
    workflows.onSessionFinished(failed, 'Agent could not finish');
    queue.onSessionFinished(failed);
    expect(started.map((session) => session.cardId)).toEqual([first.id, independent.id]);
    expect(store.card(second.id).columnId).toBe(columns[0]!.id);
    expect(store.queueCandidates(project.id, 20).length).toBe(20);
    expect(store.nextQueueCard(project.id)).toBeNull();
    store.close();
  });

  it('waits when every remaining card depends on failed work and resumes after the blocker changes', () => {
    const { store, project, template, first, second, started, workflows, queue } = fixture();
    store.setQueueContinueBlocked({ projectId: project.id, enabled: true });
    setCardRunDependencies(store, { cardId: second.id, prerequisiteCardIds: [first.id] });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const failed = store.finishSession(started[0]!.id, 'failed', 1);
    workflows.onSessionFinished(failed, 'Agent could not finish');
    queue.onSessionFinished(failed);
    expect(store.projectQueue(project.id)).toMatchObject({ state: 'running', activeWorkflowId: null });
    expect(store.runnableQueueCandidates(project.id)).toEqual([]);
    expect(started.map((session) => session.cardId)).toEqual([first.id]);
    setCardRunDependencies(store, { cardId: second.id, prerequisiteCardIds: [] });
    queue.onBoardChanged(project.id);
    expect(started.map((session) => session.cardId)).toEqual([first.id, second.id]);
    store.close();
  });

  it('defers an approval blocked card without starting its agent and keeps its record', () => {
    const { store, project, template, first, second, started, queue } = fixture();
    const approvalTemplate = store.createWorkflow({ projectId: project.id, name: 'Approval route', cardIds: template.cardIds,
      steps: template.steps.map((step) => ({ ...step, id: 'approval-step', requireApproval: true })) });
    store.setQueueContinueBlocked({ projectId: project.id, enabled: true });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: approvalTemplate.id });
    expect(started).toHaveLength(0);
    expect(store.projectQueue(project.id)).toMatchObject({ state: 'running', completedCount: 0, activeWorkflowId: null });
    const runs = store.snapshot(project.id).workflows.filter((workflow) => workflow.id !== template.id && workflow.id !== approvalTemplate.id);
    expect(new Set(runs.map((workflow) => workflow.cardIds[0]))).toEqual(new Set([first.id, second.id]));
    expect(runs.every((workflow) => workflow.queueSkip?.reason.includes('approval'))).toBe(true);
    store.close();
  });

  it('respects a deliberate queue pause even when continuation is enabled', () => {
    const { store, project, template, started, queue } = fixture();
    store.setQueueContinueBlocked({ projectId: project.id, enabled: true });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const firstFlowId = store.projectQueue(project.id).activeWorkflowId!;
    queue.setState({ projectId: project.id, state: 'paused' });
    queue.onSessionFinished(store.session(started[0]!.id));
    expect(store.projectQueue(project.id)).toMatchObject({ state: 'paused', activeWorkflowId: firstFlowId });
    expect(store.workflow(firstFlowId).queueSkip).toBeUndefined();
    expect(started).toHaveLength(1);
    store.close();
  });

  it('resumes a completed active workflow and claims exactly the next card', () => {
    const { store, project, template, second, started, workflows, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const completed = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(completed, `Done\n${DONE_MARKER}`);
    // Simulate a pause between workflow completion and queue reconciliation.
    expect(store.workflow(store.projectQueue(project.id).activeWorkflowId!).state).toBe('done');
    queue.setState({ projectId: project.id, state: 'paused' });
    expect(started).toHaveLength(1);
    const resumed = queue.setState({ projectId: project.id, state: 'running' });
    expect(resumed.state).toBe('running');
    expect(started).toHaveLength(2);
    expect(started[1]?.cardId).toBe(second.id);
    expect(store.projectQueue(project.id).completedCount).toBe(1);
    store.close();
  });

  it('stops the active agent on pause and preserves a reviewable workflow after restart', () => {
    const { store, dbPath, project, template, started, stopped, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    queue.setState({ projectId: project.id, state: 'paused' });
    expect(stopped).toEqual([started[0]!.id]);
    expect(store.workflow(activeId).state).toBe('paused');
    expect(store.workflowProgress(activeId, 0)[0]?.state).toBe('needs_review');
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    expect(reopened.projectQueue(project.id).activeWorkflowId).toBe(activeId);
    expect(reopened.snapshot(project.id).sessions).toHaveLength(1);
    reopened.close();
  });

  it('pauses on app restart without replay even if a session was running at shutdown', () => {
    const { store, dbPath, project, template, started, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    store.close(); // Simulated app loss: no agent callback.
    const reopened = new StudioStore(dbPath);
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    expect(reopened.projectQueue(project.id).pauseReason).toContain('neu gestartet');
    expect(reopened.session(started[0]!.id).state).toBe('failed');
    expect(reopened.workflow(activeId).state).toBe('paused');
    const runner = { start: () => { throw new Error('Must not replay'); }, stop: () => undefined } as unknown as SessionRunner;
    const restoredQueue = new ProjectQueueEngine(reopened, new WorkflowEngine(reopened, runner));
    restoredQueue.onBoardChanged(project.id);
    expect(reopened.snapshot(project.id).sessions).toHaveLength(1);
    expect(() => restoredQueue.setState({ projectId: project.id, state: 'running' })).toThrow('nicht selbst erneut');
    reopened.close();
  });

  it('keeps a failed run and its reason, then continues only after an explicit second action', () => {
    const { store, dbPath, project, template, first, second, started, workflows, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const firstSession = started[0]!;
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    const failed = store.finishSession(firstSession.id, 'failed', 1);
    workflows.onSessionFinished(failed, 'Agent could not finish');
    queue.onSessionFinished(failed);
    expect(store.projectQueue(project.id).state).toBe('paused');
    expect(() => queue.setState({ projectId: project.id, state: 'running' })).toThrow('nicht selbst erneut');
    expect(() => store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: '  ' })).toThrow('Grund');
    const skipped = store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: 'Externer Dienst ist nicht erreichbar' });
    expect(skipped.state).toBe('paused');
    expect(skipped.activeWorkflowId).toBeNull();
    expect(skipped.completedCount).toBe(0);
    expect(started).toHaveLength(1);
    expect(store.workflow(activeId).queueSkip?.reason).toBe('Externer Dienst ist nicht erreichbar');
    expect(store.session(firstSession.id).state).toBe('failed');
    expect(() => workflows.setState({ id: activeId, state: 'running' })).toThrow('übersprungen');
    expect(() => store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: 'nochmal' })).toThrow('aktive angehaltene');
    store.close();

    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(activeId).queueSkip?.reason).toBe('Externer Dienst ist nicht erreichbar');
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    expect(reopened.nextQueueCard(project.id)?.id).toBe(second.id);
    expect(reopened.nextQueueCard(project.id)?.id).not.toBe(first.id);
    const resumed: Session[] = [];
    const runner = { start: ({ cardId, agentId }: { cardId: string; agentId: string }) => { const session = reopened.createSession({ cardId, agentId }); resumed.push(session); return session; }, stop: () => undefined } as unknown as SessionRunner;
    const restoredQueue = new ProjectQueueEngine(reopened, new WorkflowEngine(reopened, runner));
    restoredQueue.setState({ projectId: project.id, state: 'running' });
    expect(resumed.map((item) => item.cardId)).toEqual([second.id]);
    expect(reopened.workflow(activeId).queueSkip?.reason).toBe('Externer Dienst ist nicht erreichbar');
    reopened.close();
  });

  it('refuses to skip a running workflow or while any project session is live', () => {
    const { store, project, template, first, started, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    expect(() => store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: 'Blockiert' })).toThrow('aktive angehaltene');
    queue.setState({ projectId: project.id, state: 'paused' });
    const agentId = started[0]!.agentId;
    const unrelated = store.createSession({ cardId: first.id, agentId });
    expect(() => store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: 'Blockiert' })).toThrow('Agent läuft');
    expect(store.projectQueue(project.id).activeWorkflowId).toBe(activeId);
    expect(store.workflow(activeId).queueSkip).toBeUndefined();
    store.finishSession(unrelated.id, 'stopped', null);
    store.close();
  });

  it('requires an explicit skip for an approval pause and never counts it as completed', () => {
    const { store, project, template, started, queue } = fixture();
    const approvalTemplate = store.createWorkflow({ projectId: project.id, name: 'Approval route', cardIds: template.cardIds, steps: template.steps.map((step) => ({ ...step, id: 'approval-step', requireApproval: true })) });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: approvalTemplate.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    expect(store.workflow(activeId).pauseReason).toBe('approval');
    expect(started).toHaveLength(0);
    expect(store.projectQueue(project.id).state).toBe('paused');
    store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: 'Freigabe aktuell nicht möglich' });
    expect(store.projectQueue(project.id).completedCount).toBe(0);
    expect(store.workflow(activeId).pauseReason).toBe('approval');
    store.close();
  });

  it('does not skip an already completed workflow', () => {
    const { store, project, template, started, workflows, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    const finished = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(finished, `Done\n${DONE_MARKER}`);
    queue.setState({ projectId: project.id, state: 'paused' });
    expect(store.workflow(activeId).state).toBe('done');
    expect(() => store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: 'Nicht nötig' })).toThrow('nicht pausiert');
    store.close();
  });

  it('also resolves a stopped queue without silently reactivating it', () => {
    const { store, project, template, second, started, queue } = fixture();
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    const activeId = store.projectQueue(project.id).activeWorkflowId!;
    queue.setState({ projectId: project.id, state: 'off' });
    expect(store.workflow(activeId).state).toBe('paused');
    const result = store.skipQueuedCard({ projectId: project.id, workflowId: activeId, reason: 'User chose another task' });
    expect(result.state).toBe('off');
    expect(result.activeWorkflowId).toBeNull();
    expect(started).toHaveLength(1);
    expect(store.nextQueueCard(project.id)?.id).toBe(second.id);
    store.close();
  });
});
