import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSpawnError, DONE_MARKER, type SessionRunner } from '../../src/main/cli';
import { reserveCardSession, cardRunGate } from '../../src/main/parallel-runs';
import { projectRunPause, setProjectRunPause } from '../../src/main/project-pause';
import { ProjectQueueEngine } from '../../src/main/queue';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';
import type { Session } from '../../src/shared/types';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-project-pause-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Pause fixture', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.saveAgent({ name: 'Synthetic agent', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
  const first = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'First task' });
  const second = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Second task' });
  return { store, file, project, columns, agent, first, second };
}

function fakeRunner(store: StudioStore, started: Session[], stopped: string[]): SessionRunner {
  return {
    start: ({ cardId, agentId }: { cardId: string; agentId: string }) => {
      const session = reserveCardSession(store, { cardId, agentId });
      started.push(session);
      return session;
    },
    stop: (id: string) => { stopped.push(id); store.finishSession(id, 'stopped', null); },
  } as unknown as SessionRunner;
}

describe('durable project-wide safe pause', () => {
  it('blocks the reservation race, leaves the running process alone and needs an explicit resume', () => {
    const { store, project, agent, first, second } = fixture();
    const current = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    expect(cardRunGate(store, second.id).canStart).toBe(true);
    const requested = setProjectRunPause(store, { projectId: project.id, paused: true });
    expect(requested.state).toBe('requested');
    expect(requested.running).toMatchObject([{ kind: 'agent', id: current.id, cardId: first.id, title: first.title }]);
    expect(store.session(current.id).state).toBe('running');
    expect(cardRunGate(store, second.id).canStart).toBe(false);
    expect(() => reserveCardSession(store, { cardId: second.id, agentId: agent.id })).toThrow('sicher angehalten');
    const otherPath = join(project.path, 'other');
    mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other project', path: otherPath });
    const otherCard = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Independent' });
    const otherRun = reserveCardSession(store, { cardId: otherCard.id, agentId: agent.id });
    expect(otherRun.state).toBe('running');
    store.finishSession(otherRun.id, 'exited', 0);
    expect(() => setProjectRunPause(store, { projectId: project.id, paused: false })).toThrow('Warte auf das Ende');
    store.finishSession(current.id, 'exited', 0);
    expect(projectRunPause(store, project.id).state).toBe('paused');
    expect(store.session(current.id)).toMatchObject({ state: 'exited', exitCode: 0 });
    expect(store.snapshot(project.id).runPause.state).toBe('paused');
    setProjectRunPause(store, { projectId: project.id, paused: false });
    expect(cardRunGate(store, second.id).canStart).toBe(true);
    store.close();
  });

  it('keeps a completed workflow step but does not launch its successor or stop a live agent', () => {
    const { store, project, agent, first, columns } = fixture();
    const started: Session[] = [];
    const stopped: string[] = [];
    const engine = new WorkflowEngine(store, fakeRunner(store, started, stopped));
    const flow = store.createWorkflow({ projectId: project.id, name: 'Two steps', cardIds: [first.id], steps: [
      { id: 'one', columnId: columns[1]!.id, agentId: agent.id, requireApproval: false },
      { id: 'two', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false },
    ] });
    engine.setState({ id: flow.id, state: 'running' });
    expect(started).toHaveLength(1);
    setProjectRunPause(store, { projectId: project.id, paused: true });
    expect(stopped).toEqual([]);
    store.appendOutput(started[0]!.id, `Finished work\n${DONE_MARKER}\n`);
    const finished = store.finishSession(started[0]!.id, 'exited', 0);
    engine.onSessionFinished(finished);
    expect(started).toHaveLength(1);
    expect(store.workflow(flow.id)).toMatchObject({ state: 'paused', currentStep: 0 });
    expect(store.workflowProgress(flow.id, 0)).toMatchObject([{ state: 'complete', sessionId: started[0]!.id }]);
    expect(() => engine.setState({ id: flow.id, state: 'running' })).toThrow('sicher angehalten');
    setProjectRunPause(store, { projectId: project.id, paused: false });
    expect(started).toHaveLength(1);
    engine.setState({ id: flow.id, state: 'running' });
    expect(started).toHaveLength(2);
    expect(store.workflow(flow.id).currentStep).toBe(1);
    store.close();
  });

  it('stops an active queue without claiming the next card and persists the stop across restart', () => {
    const { store, file, project, agent, first, columns } = fixture();
    const started: Session[] = [];
    const stopped: string[] = [];
    const workflows = new WorkflowEngine(store, fakeRunner(store, started, stopped));
    const queue = new ProjectQueueEngine(store, workflows);
    const template = store.createWorkflow({ projectId: project.id, name: 'Queue route', cardIds: [first.id], steps: [
      { id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false },
    ] });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(started).toHaveLength(1);
    setProjectRunPause(store, { projectId: project.id, paused: true });
    expect(store.projectQueue(project.id).state).toBe('paused');
    expect(stopped).toEqual([]);
    store.appendOutput(started[0]!.id, `${DONE_MARKER}\n`);
    const finished = store.finishSession(started[0]!.id, 'exited', 0);
    workflows.onSessionFinished(finished);
    queue.onSessionFinished(finished);
    expect(started).toHaveLength(1);
    expect((store.db.prepare('SELECT COUNT(*) AS count FROM queue_runs WHERE project_id = ?').get(project.id) as { count: number }).count).toBe(1);
    expect(store.workflow(store.projectQueue(project.id).activeWorkflowId!).state).toBe('paused');
    queue.dispose();
    store.close();

    const reopened = new StudioStore(file);
    expect(reopened.snapshot(project.id).runPause.state).toBe('paused');
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    expect(reopened.snapshot(project.id).sessions).toHaveLength(1);
    expect(() => new ProjectQueueEngine(reopened, new WorkflowEngine(reopened, fakeRunner(reopened, [], [])))
      .setState({ projectId: project.id, state: 'running' })).toThrow('sicher angehalten');
    setProjectRunPause(reopened, { projectId: project.id, paused: false });
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    reopened.close();
  });

  it('keeps a crash-interrupted run reviewable and never replays it on reopen', () => {
    const { store, file, project, agent, first } = fixture();
    const run = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    setProjectRunPause(store, { projectId: project.id, paused: true });
    store.close();
    const reopened = new StudioStore(file);
    expect(reopened.session(run.id).state).toBe('failed');
    expect(reopened.snapshot(project.id).runPause.state).toBe('paused');
    expect(reopened.snapshot(project.id).sessions).toHaveLength(1);
    expect(() => reserveCardSession(reopened, { cardId: first.id, agentId: agent.id })).toThrow('sicher angehalten');
    reopened.close();
  });

  it('removes a queued CLI retry and does not start it after the pause request', () => {
    vi.useFakeTimers();
    const { store, project, agent, first, columns } = fixture();
    let attempts = 0;
    const runner = { start: () => { attempts += 1; throw new AgentSpawnError('synthetic synchronous spawn failure'); }, stop: () => undefined } as unknown as SessionRunner;
    const workflows = new WorkflowEngine(store, runner);
    const queue = new ProjectQueueEngine(store, workflows);
    const template = store.createWorkflow({ projectId: project.id, name: 'Retry route', cardIds: [first.id], steps: [
      { id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false },
    ] });
    queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
    expect(attempts).toBe(1);
    expect(store.queueLaunchRetry(project.id)).not.toBeNull();
    setProjectRunPause(store, { projectId: project.id, paused: true });
    expect(store.queueLaunchRetry(project.id)).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(1);
    expect(store.projectQueue(project.id).state).toBe('paused');
    queue.dispose();
    store.close();
  });

  it('shows active integration work as remaining work until it actually ends', () => {
    const { store, file, project, first } = fixture();
    const stamp = new Date().toISOString();
    const item = store.db.prepare(`INSERT INTO integration_items
      (project_id, card_id, repository_key, target_branch, source_head, target_head, card_fingerprint, preview_token,
       state, reason, created_at, updated_at, integrated_head, owner_pid)
      VALUES (?, ?, ?, 'main', 'a', 'b', 'fingerprint', 'token', 'integrating', NULL, ?, ?, NULL, ?)`)
      .run(project.id, first.id, 'fixture', stamp, stamp, process.pid);
    const test = store.db.prepare(`INSERT INTO integration_test_runs
      (item_id, card_id, source_head, target_head, card_fingerprint, script_name, script_hash,
       state, exit_code, output_tail, started_at, ended_at, owner_pid)
      VALUES (?, ?, 'a', 'b', 'fingerprint', 'test', 'hash', 'running', NULL, '', ?, NULL, ?)`)
      .run(item.lastInsertRowid, first.id, stamp, process.pid);
    const requested = setProjectRunPause(store, { projectId: project.id, paused: true });
    expect(requested.state).toBe('requested');
    expect(requested.running.map((row) => row.kind)).toEqual(['integration-test', 'integration']);
    store.db.prepare("UPDATE integration_test_runs SET state = 'passed', ended_at = ? WHERE id = ?").run(stamp, test.lastInsertRowid);
    expect(projectRunPause(store, project.id).state).toBe('requested');
    store.db.prepare('UPDATE integration_items SET owner_pid = NULL WHERE id = ?').run(item.lastInsertRowid);
    expect(projectRunPause(store, project.id).state).toBe('paused');
    store.db.prepare("UPDATE integration_items SET state = 'integrated' WHERE id = ?").run(item.lastInsertRowid);
    expect(projectRunPause(store, project.id).state).toBe('paused');
    store.db.prepare("UPDATE integration_test_runs SET state = 'running', ended_at = NULL, owner_pid = NULL WHERE id = ?")
      .run(test.lastInsertRowid);
    store.close();
    const reopened = new StudioStore(file);
    expect(reopened.snapshot(project.id).runPause.state).toBe('paused');
    expect((reopened.db.prepare('SELECT state FROM integration_test_runs WHERE id = ?').get(test.lastInsertRowid) as { state: string }).state)
      .toBe('interrupted');
    reopened.close();
  });
});
