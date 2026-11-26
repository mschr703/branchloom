import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../../src/shared/types';
import { DONE_MARKER, type SessionRunner } from '../../src/main/cli';
import { SessionRecoveryMonitor } from '../../src/main/session-recovery';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';
import { ProjectQueueEngine, testCompletedQueueCard } from '../../src/main/queue';
import { npmScriptApprovalHash, setIntegrationTestScript } from '../../src/main/integration-evidence';

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture(postCheck?: typeof testCompletedQueueCard) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-network-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic network', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.agents().find((item) => item.kind === 'codex')!;
  const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'First queued' });
  const second = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Second queued' });
  const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template' });
  const template = store.createWorkflow({ projectId: project.id, name: 'One step', cardIds: [templateCard.id], steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
  let online = true;
  const launches: Session[] = [];
  const runner = { start: ({ cardId, agentId }: { cardId: string; agentId: string }) => {
    const session = store.createSession({ cardId, agentId }); launches.push(session); return session;
  }, stop: (id: string) => { store.finishSession(id, 'stopped', null); } } as unknown as SessionRunner;
  const workflows = new WorkflowEngine(store, runner, () => online);
  const queue = new ProjectQueueEngine(store, workflows, () => online, postCheck);
  const monitor = new SessionRecoveryMonitor(store, () => online, (id) => launches.some((session) => session.id === id && store.session(id).state === 'running'),
    (id) => queue.pauseForConnectionLoss(id), () => queue.resumeIdleAfterReconnect());
  return { root, file, store, project, card, second, template, launches, workflows, queue, monitor, setOnline: (value: boolean) => { online = value; } };
}

function enableAutomaticTest(f: ReturnType<typeof fixture>): void {
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: 'test' });
  f.store.setQueueAutoTest({ projectId: f.project.id, enabled: true, confirm: true });
}

describe('session recovery after a device network signal changes', () => {
  it('requires explicit consent and pins the chosen npm script before unattended tests', () => {
    const f = fixture();
    expect(() => f.store.setQueueAutoTest({ projectId: f.project.id, enabled: true, confirm: true })).toThrow('Configure');
    writeFileSync(join(f.root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: 'test' });
    expect(() => f.store.setQueueAutoTest({ projectId: f.project.id, enabled: true, confirm: false })).toThrow('consent');
    expect(f.store.setQueueAutoTest({ projectId: f.project.id, enabled: true, confirm: true }).autoTest).toBe(true);
    const hash = (f.store.db.prepare('SELECT auto_test_script_hash AS hash FROM project_queues WHERE project_id = ?')
      .get(f.project.id) as { hash: string }).hash;
    expect(hash).toBe(npmScriptApprovalHash(f.root, 'test'));
    expect(() => setIntegrationTestScript(f.store, { projectId: f.project.id, scriptName: 'build' })).toThrow('Disable automatic queue tests');
    expect(f.store.setQueueAutoTest({ projectId: f.project.id, enabled: false, confirm: false }).autoTest).toBe(false);
    f.queue.dispose(); f.store.close();
    const reopened = new StudioStore(f.file);
    expect(reopened.projectQueue(f.project.id).autoTest).toBe(false);
    reopened.close();
  });

  it('holds the next card until a persisted, approved test receipt exists', async () => {
    let finishCheck: (() => void) | null = null;
    const postCheck = vi.fn(async () => new Promise<void>((resolve) => { finishCheck = resolve; }));
    const f = fixture(postCheck);
    enableAutomaticTest(f);
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    const first = f.launches[0]!;
    const finished = f.store.finishSession(first.id, 'exited', 0);
    f.workflows.onSessionFinished(finished, DONE_MARKER);
    f.queue.onSessionFinished(finished);
    expect(postCheck).toHaveBeenCalledOnce();
    expect(f.launches).toHaveLength(1);
    f.queue.onBoardChanged(f.project.id);
    expect(f.launches).toHaveLength(1);
    if (!finishCheck) throw new Error('Missing test completion');
    finishCheck();
    await vi.waitFor(() => expect(f.store.projectQueue(f.project.id).state).toBe('paused'));
    expect(f.store.projectQueue(f.project.id).pauseReason).toContain('Testbeleg');
    f.queue.setState({ projectId: f.project.id, state: 'running' });
    expect(f.store.projectQueue(f.project.id).state).toBe('paused');
    expect(f.launches).toHaveLength(1);
    f.queue.dispose(); f.store.close();
  });

  it('stops after a failed unattended check and does not claim the next card', async () => {
    const f = fixture(vi.fn(async () => { throw new Error('Synthetic npm test failed'); }));
    enableAutomaticTest(f);
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    const first = f.launches[0]!;
    const finished = f.store.finishSession(first.id, 'exited', 0);
    f.workflows.onSessionFinished(finished, DONE_MARKER);
    f.queue.onSessionFinished(finished);
    await Promise.resolve(); await Promise.resolve();
    expect(f.store.projectQueue(f.project.id)).toMatchObject({ state: 'paused' });
    expect(f.store.projectQueue(f.project.id).pauseReason).toContain('Synthetic npm test failed');
    expect(f.launches).toHaveLength(1);
    f.queue.dispose(); f.store.close();
  });
  it('pauses an existing queue on an offline monitor start without replaying its live card', () => {
    const f = fixture();
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    const first = f.launches[0]!;
    f.setOnline(false);
    f.monitor.start();
    expect(f.store.projectQueue(f.project.id).state).toBe('paused');
    expect(f.store.session(first.id).state).toBe('running');
    expect(f.monitor.state(first.id)).toMatchObject({ signal: 'offline', process: 'attached' });
    expect(f.launches).toHaveLength(1);
    f.monitor.dispose(); f.queue.dispose(); f.store.close();
  });

  it('preserves the in-flight PTY, pauses automatic work, and never starts twice on reconnect', () => {
    const f = fixture();
    f.store.setQueueAutoResumeIdle({ projectId: f.project.id, enabled: true });
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    expect(f.launches).toHaveLength(1);
    const first = f.launches[0]!;
    expect(f.monitor.state(first.id)).toMatchObject({ signal: 'online', process: 'attached', events: [{ signal: 'online' }] });
    f.setOnline(false);
    expect(f.monitor.state(first.id)).toMatchObject({ signal: 'offline', process: 'attached', events: [{ signal: 'offline' }, { signal: 'online' }] });
    expect(f.store.session(first.id).state).toBe('running');
    expect(f.store.projectQueue(f.project.id).state).toBe('paused');
    const active = f.store.projectQueue(f.project.id).activeWorkflowId!;
    expect(f.store.workflow(active).state).toBe('paused');
    expect(() => f.workflows.setState({ id: active, state: 'running' })).toThrow('offline');
    expect(() => f.queue.setState({ projectId: f.project.id, state: 'running' })).toThrow('offline');
    f.setOnline(true);
    f.monitor.poll(); f.monitor.poll();
    expect(f.monitor.state(first.id).events.map((item) => item.signal)).toEqual(['online', 'offline', 'online']);
    expect(f.store.projectQueue(f.project.id).state).toBe('paused');
    expect(f.launches.map((session) => session.id)).toEqual([first.id]);
    expect(() => f.workflows.setState({ id: active, state: 'running' })).toThrow('läuft noch');
    const finished = f.store.finishSession(first.id, 'exited', 0);
    f.workflows.onSessionFinished(finished, DONE_MARKER);
    f.queue.onSessionFinished(finished);
    expect(f.store.workflow(active).state).toBe('paused');
    expect(f.store.projectQueue(f.project.id).state).toBe('paused');
    expect(f.launches.map((session) => session.id)).toEqual([first.id]);
    expect(f.store.queueCandidates(f.project.id).some((item) => item.id === f.second.id)).toBe(true);
    f.queue.dispose(); f.store.close();
  });

  it('continues an opted-in idle queue after reconnect while keeping earlier work untouched', () => {
    const f = fixture();
    f.store.setCardArchived({ id: f.card.id, archived: true });
    f.store.setCardArchived({ id: f.second.id, archived: true });
    expect(f.store.setQueueAutoResumeIdle({ projectId: f.project.id, enabled: true }).autoResumeIdle).toBe(true);
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    expect(f.store.projectQueue(f.project.id).activeWorkflowId).toBeNull();
    expect(f.launches).toHaveLength(0);
    const activationCount = () => (f.store.db.prepare('SELECT count(*) AS count FROM queue_activations WHERE project_id = ?')
      .get(f.project.id) as { count: number }).count;
    expect(activationCount()).toBe(1);
    f.monitor.poll();
    f.setOnline(false); f.monitor.poll();
    expect(f.store.projectQueue(f.project.id)).toMatchObject({ state: 'paused', autoResumeIdle: true });
    const newCard = f.store.createCard({ projectId: f.project.id, columnId: f.store.snapshot(f.project.id).columns[0]!.id, title: 'After reconnect' });
    f.setOnline(true); f.monitor.poll(); f.monitor.poll();
    expect(f.store.projectQueue(f.project.id).state).toBe('running');
    expect(f.launches.map((session) => session.cardId)).toEqual([newCard.id]);
    expect(activationCount()).toBe(2);
    expect(() => f.store.setQueueAutoResumeIdle({ projectId: f.project.id, enabled: false })).toThrow('Pause the queue');
    f.monitor.dispose(); f.queue.dispose(); f.store.close();
  });

  it('does not resume an idle queue after its selected deadline has passed offline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T01:00:00.000Z'));
    const f = fixture();
    f.store.setCardArchived({ id: f.card.id, archived: true });
    f.store.setCardArchived({ id: f.second.id, archived: true });
    f.store.setQueueAutoResumeIdle({ projectId: f.project.id, enabled: true });
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id, runUntil: '2026-11-26T01:01:00.000Z' });
    f.monitor.poll();
    f.setOnline(false); f.monitor.poll();
    vi.setSystemTime(new Date('2026-11-26T01:02:00.000Z'));
    f.setOnline(true); f.monitor.poll();
    expect(f.store.projectQueue(f.project.id).state).toBe('paused');
    expect(f.store.projectQueue(f.project.id).pauseReason).toContain('Endzeit');
    expect(f.launches).toHaveLength(0);
    f.monitor.dispose(); f.queue.dispose(); f.store.close();
  });

  it('does not override a deliberate pause made during the outage', () => {
    const f = fixture();
    f.store.setCardArchived({ id: f.card.id, archived: true });
    f.store.setCardArchived({ id: f.second.id, archived: true });
    f.store.setQueueAutoResumeIdle({ projectId: f.project.id, enabled: true });
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    f.monitor.poll();
    f.setOnline(false); f.monitor.poll();
    f.queue.setState({ projectId: f.project.id, state: 'paused' });
    f.setOnline(true); f.monitor.poll();
    expect(f.store.projectQueue(f.project.id)).toMatchObject({ state: 'paused', pauseReason: 'Vom Nutzer pausiert; aktiven Workflow vor Fortsetzung prüfen.' });
    expect(f.launches).toHaveLength(0);
    f.monitor.dispose(); f.queue.dispose(); f.store.close();
  });

  it('does not apply a reconnect opt-in retroactively to an earlier offline pause', () => {
    const f = fixture();
    f.store.setCardArchived({ id: f.card.id, archived: true });
    f.store.setCardArchived({ id: f.second.id, archived: true });
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    f.monitor.poll();
    f.setOnline(false); f.monitor.poll();
    f.store.setQueueAutoResumeIdle({ projectId: f.project.id, enabled: true });
    f.setOnline(true); f.monitor.poll();
    expect(f.store.projectQueue(f.project.id).state).toBe('paused');
    expect(f.launches).toHaveLength(0);
    f.monitor.dispose(); f.queue.dispose(); f.store.close();
  });

  it('keeps network observations and uncertain writes after restart without replaying a queue card', () => {
    const f = fixture();
    f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id });
    const first = f.launches[0]!;
    f.monitor.poll();
    f.setOnline(false); f.monitor.poll();
    f.store.appendOutput(first.id, 'Synthetic partial work before Wi-Fi loss');
    f.queue.dispose(); f.store.close();
    const reopened = new StudioStore(f.file);
    const after = new SessionRecoveryMonitor(reopened, () => true, () => false, () => undefined);
    expect(after.state(first.id)).toMatchObject({ signal: 'online', process: 'interrupted' });
    expect(after.state(first.id).events.map((item) => item.signal)).toEqual(['offline', 'online']);
    expect(reopened.session(first.id)).toMatchObject({ state: 'failed', exitCode: null });
    expect(reopened.session(first.id).output).toContain('Synthetic partial work');
    expect(reopened.projectQueue(f.project.id).state).toBe('paused');
    expect(reopened.snapshot(f.project.id).sessions.filter((session) => session.cardId === f.card.id)).toHaveLength(1);
    expect(f.launches).toHaveLength(1);
    reopened.close();
  });

  it('refuses an offline queue start and leaves a manual card session untouched', () => {
    const f = fixture();
    f.setOnline(false);
    expect(() => f.queue.setState({ projectId: f.project.id, state: 'running', templateWorkflowId: f.template.id })).toThrow('offline');
    expect(f.store.projectQueue(f.project.id).state).toBe('off');
    const agent = f.store.agents()[0]!;
    const manual = f.store.createSession({ cardId: f.card.id, agentId: agent.id });
    const before = f.store.snapshot(f.project.id).sessions.length;
    expect(f.monitor.state(manual.id)).toMatchObject({ signal: 'offline', process: 'unconfirmed' });
    f.setOnline(true);
    expect(f.monitor.state(manual.id).signal).toBe('online');
    expect(f.store.snapshot(f.project.id).sessions).toHaveLength(before);
    f.store.finishSession(manual.id, 'stopped', null);
    expect(f.monitor.state(manual.id).process).toBe('ended');
    f.queue.dispose(); f.store.close();
  });
});
