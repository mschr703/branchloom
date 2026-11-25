import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DONE_MARKER, SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';
import type { Session } from '../../src/shared/types';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-haltpoint-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.saveAgent({ name: 'Synthetic', kind: 'antigravity', command: process.execPath, args: [], model: null, enabled: true });
  const cardA = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'A' });
  const cardB = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'B' });
  const cardC = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'C' });
  const started: Session[] = [];
  const runner = { start: ({ cardId, agentId }: { cardId: string; agentId: string }) => { const session = store.createSession({ cardId, agentId }); started.push(session); return session; }, stop: () => undefined } as unknown as SessionRunner;
  const engine = new WorkflowEngine(store, runner);
  const complete = (session: Session) => { store.appendOutput(session.id, `Done\n${DONE_MARKER}`); engine.onSessionFinished(store.finishSession(session.id, 'exited', 0)); };
  return { store, file, project, columns, agent, cardA, cardB, cardC, engine, started, complete };
}

describe('workflow step haltpoints', () => {
  it('parks a real local CLI between steps and starts the successor only after restart and resume', async () => {
    const f = fixture();
    f.store.close();
    const script = join(f.project.path, 'synthetic-agent.cjs');
    const counter = join(f.project.path, 'launches.txt');
    writeFileSync(script, `const fs = require('node:fs'); const file = ${JSON.stringify(counter)}; fs.appendFileSync(file, 'launch\\n'); console.log('${DONE_MARKER}');`);
    const store = new StudioStore(f.file);
    const agent = store.saveAgent({ name: 'Real synthetic CLI', kind: 'antigravity', command: process.execPath, args: [script], model: null, enabled: true });
    const flow = store.createWorkflow({ projectId: f.project.id, name: 'Real route', cardIds: [f.cardA.id], steps: [
      { id: 'build', columnId: f.columns[1]!.id, agentId: agent.id, requireApproval: false },
      { id: 'test', columnId: f.columns[2]!.id, agentId: agent.id, requireApproval: false },
    ] });
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 0 });
    engine.setState({ id: flow.id, state: 'running' });
    for (let attempt = 0; attempt < 100 && store.workflow(flow.id).haltpoint?.state !== 'reached'; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(store.workflow(flow.id)).toMatchObject({ state: 'paused', currentStep: 1, haltpoint: { state: 'reached' } });
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(1);
    runner.dispose(); store.close();
    const reopened = new StudioStore(f.file);
    expect(reopened.workflow(flow.id).haltpoint?.state).toBe('reached');
    let nextEngine!: WorkflowEngine;
    const nextRunner = new SessionRunner(reopened, () => undefined, (session, finalMessage) => nextEngine.onSessionFinished(session, finalMessage));
    nextEngine = new WorkflowEngine(reopened, nextRunner);
    try {
      expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(1);
      nextEngine.setState({ id: flow.id, state: 'running' });
      for (let attempt = 0; attempt < 100 && reopened.workflow(flow.id).state !== 'done'; attempt++) await new Promise((resolve) => setTimeout(resolve, 100));
      expect(reopened.workflow(flow.id).state).toBe('done');
      expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(2);
    } finally { nextRunner.dispose(); reopened.close(); }
  }, 30_000);

  it('waits for every parallel card, reaches the boundary once and leaves independent work running', () => {
    const f = fixture();
    const flow = f.store.createWorkflow({ projectId: f.project.id, name: 'Two cards', cardIds: [f.cardA.id, f.cardB.id], steps: [
      { id: 'build', columnId: f.columns[1]!.id, agentId: f.agent.id, requireApproval: false, parallel: true, useWorktree: true },
      { id: 'review', columnId: f.columns[2]!.id, agentId: f.agent.id, requireApproval: false },
    ] });
    // This independent workflow shares neither card nor haltpoint.
    const other = f.store.createWorkflow({ projectId: f.project.id, name: 'Independent', cardIds: [f.cardC.id], steps: [
      { id: 'other', columnId: f.columns[1]!.id, agentId: f.agent.id, requireApproval: false },
    ] });
    f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 0 });
    f.engine.setState({ id: flow.id, state: 'running' });
    expect(f.started).toHaveLength(2);
    f.engine.setState({ id: other.id, state: 'running' });
    expect(f.started).toHaveLength(3);
    f.complete(f.started[0]!);
    expect(f.store.workflow(flow.id)).toMatchObject({ state: 'running', currentStep: 0, haltpoint: { state: 'requested' } });
    f.complete(f.started[2]!);
    expect(f.store.workflow(other.id).state).toBe('done');
    f.complete(f.started[1]!);
    expect(f.store.workflow(flow.id)).toMatchObject({ state: 'paused', currentStep: 1, pauseReason: 'haltpoint', haltpoint: { state: 'reached', afterStepIndex: 0 } });
    expect(f.store.snapshot(f.project.id).workflows.find((item) => item.id === flow.id)?.haltpoint?.state).toBe('reached');
    expect(f.started).toHaveLength(3);
    // Duplicate and late completion notifications cannot launch the next step.
    f.engine.onSessionFinished(f.store.session(f.started[1]!.id));
    expect(f.started).toHaveLength(3);
    f.engine.setState({ id: flow.id, state: 'running' });
    expect(f.started).toHaveLength(4);
    expect(f.store.workflow(flow.id).haltpoint).toBeUndefined();
    f.store.close();
  });

  it('keeps requested and reached states durable and requires a separate next-step approval', () => {
    const f = fixture();
    const flow = f.store.createWorkflow({ projectId: f.project.id, name: 'Approval after halt', cardIds: [f.cardA.id], steps: [
      { id: 'build', columnId: f.columns[1]!.id, agentId: f.agent.id, requireApproval: false },
      { id: 'review', columnId: f.columns[2]!.id, agentId: f.agent.id, requireApproval: true },
    ] });
    f.engine.setState({ id: flow.id, state: 'running' });
    f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 0 });
    expect(f.store.workflow(flow.id).haltpoint?.state).toBe('requested');
    f.complete(f.started[0]!);
    expect(f.store.workflow(flow.id).haltpoint?.state).toBe('reached');
    f.store.close();
    const reopened = new StudioStore(f.file);
    expect(reopened.workflow(flow.id)).toMatchObject({ state: 'paused', currentStep: 1, pauseReason: 'haltpoint', haltpoint: { state: 'reached' } });
    const started: Session[] = [];
    const runner = { start: ({ cardId, agentId }: { cardId: string; agentId: string }) => { const session = reopened.createSession({ cardId, agentId }); started.push(session); return session; }, stop: () => undefined } as unknown as SessionRunner;
    const engine = new WorkflowEngine(reopened, runner);
    engine.setState({ id: flow.id, state: 'running' });
    expect(reopened.workflow(flow.id)).toMatchObject({ state: 'paused', pauseReason: 'approval' });
    expect(started).toHaveLength(0);
    expect(reopened.isStepApproved(flow.id, 1)).toBe(false);
    engine.setState({ id: flow.id, state: 'running' });
    expect(started).toHaveLength(1);
    reopened.close();
  });

  it('rejects stale boundaries and permits changing or removing a requested haltpoint', () => {
    const f = fixture();
    const flow = f.store.createWorkflow({ projectId: f.project.id, name: 'Three steps', cardIds: [f.cardA.id], steps: [
      { id: 'one', columnId: f.columns[1]!.id, agentId: f.agent.id, requireApproval: false },
      { id: 'two', columnId: f.columns[2]!.id, agentId: f.agent.id, requireApproval: false },
      { id: 'three', columnId: f.columns[3]!.id, agentId: f.agent.id, requireApproval: false },
    ] });
    expect(() => f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 2 })).toThrow('before the final');
    f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 0 });
    f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 1 });
    expect(f.store.workflow(flow.id).haltpoint?.afterStepIndex).toBe(1);
    f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: null });
    expect(f.store.workflow(flow.id).haltpoint).toBeUndefined();
    f.engine.setState({ id: flow.id, state: 'running' });
    f.complete(f.started[0]!);
    expect(f.started).toHaveLength(2);
    expect(() => f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 0 })).toThrow('upcoming');
    f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: 1 });
    f.complete(f.started[1]!);
    expect(f.store.workflow(flow.id).haltpoint?.state).toBe('reached');
    f.engine.setStepHaltpoint({ id: flow.id, afterStepIndex: null });
    expect(f.store.workflow(flow.id).haltpoint).toBeUndefined();
    expect(f.store.workflow(flow.id).state).toBe('paused');
    f.store.close();
  });
});
