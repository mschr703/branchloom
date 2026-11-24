import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';
import { globalInboxItems } from '../../src/main/global-inbox';
import { ensureCardWorktree } from '../../src/main/git-worktree';
import { reserveCardSession } from '../../src/main/parallel-runs';

const roots: string[] = [];
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr || result.error));
}

function fixture(withGit = true) {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-workflow-worktree-'));
  roots.push(root);
  const repository = join(root, 'repository');
  mkdirSync(repository);
  if (withGit) {
    git(repository, ['init', '-q']);
    writeFileSync(join(repository, 'tracked.txt'), 'original\n');
    git(repository, ['add', 'tracked.txt']);
    git(repository, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Initial']);
  }
  const dbPath = join(root, 'data', 'studio.sqlite');
  mkdirSync(join(root, 'data'));
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: repository });
  const column = store.snapshot(project.id).columns[2]!;
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Synthetic task' });
  const script = join(root, 'agent.cjs');
  writeFileSync(script, 'require("node:fs").writeFileSync("worktree-result.txt", "synthetic"); console.log("[JARVIS_STEP_DONE]");\n');
  const agent = store.saveAgent({ name: 'Synthetic Node', kind: 'custom', command: process.execPath, args: [script], model: null, enabled: true });
  return { root, repository, dbPath, store, project, column, card, agent };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Der synthetische Workflow endete nicht rechtzeitig.');
}

describe('optional card worktree in workflow steps', () => {
  it('runs independent cards concurrently in separate worktrees when the step opts in', async () => {
    const { root, repository, dbPath, store, project, column, card, agent } = fixture();
    const second = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Second task' });
    writeFileSync(join(root, 'agent.cjs'), 'setTimeout(() => { require("node:fs").writeFileSync("worktree-result.txt", "done"); console.log("[JARVIS_STEP_DONE]"); }, 500);\n');
    const flow = store.createWorkflow({ projectId: project.id, name: 'Parallel step', cardIds: [card.id, second.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: true, parallel: true },
    ] });
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      const live = store.runningSessionsForProject(project.id);
      expect(live).toHaveLength(2);
      expect(new Set(live.map((session) => session.cardId))).toEqual(new Set([card.id, second.id]));
      expect(new Set(live.map((session) => session.worktreePath)).size).toBe(2);
      await waitFor(() => store.workflow(flow.id).state === 'done');
      expect(store.workflowProgress(flow.id, 0).map((row) => row.state)).toEqual(['complete', 'complete']);
      for (const id of [card.id, second.id]) {
        expect(readFileSync(join(store.cardWorktree(id)!.path, 'worktree-result.txt'), 'utf8')).toBe('done');
      }
      expect(existsSync(join(repository, 'worktree-result.txt'))).toBe(false);
    } finally { runner.dispose(); store.close(); }
    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(flow.id).state).toBe('done');
    expect(reopened.workflow(flow.id).steps[0]?.parallel).toBe(true);
    reopened.close();
  }, 35_000);

  it('keeps a dependent card pending until its predecessor has a verified workflow result', async () => {
    const { root, store, project, column, card, agent } = fixture();
    const dependent = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Dependent task' });
    store.db.prepare('INSERT INTO card_splits (id, parent_card_id, child_card_id, depends_on_card_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('dependency-link', card.id, dependent.id, card.id, 1, new Date().toISOString());
    writeFileSync(join(root, 'agent.cjs'), 'setTimeout(() => console.log("[JARVIS_STEP_DONE]"), 250);\n');
    const flow = store.createWorkflow({ projectId: project.id, name: 'Dependency step', cardIds: [card.id, dependent.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: true, parallel: true },
    ] });
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      expect(store.runningSessionsForProject(project.id).map((session) => session.cardId)).toEqual([card.id]);
      expect(store.latestSession(dependent.id)).toBeNull();
      await waitFor(() => store.workflow(flow.id).state === 'done');
      expect(store.workflowProgress(flow.id, 0).map((row) => row.state)).toEqual(['complete', 'complete']);
      expect(store.snapshot(project.id).sessions.filter((session) => session.cardId === dependent.id)).toHaveLength(1);
    } finally { runner.dispose(); store.close(); }
  }, 35_000);

  it('pauses both parallel sessions and does not replay them after restart', () => {
    const { dbPath, store, project, column, card, agent } = fixture();
    const second = store.createCard({ projectId: project.id, columnId: card.columnId, title: 'Second task' });
    const flow = store.createWorkflow({ projectId: project.id, name: 'Restartable parallel step', cardIds: [card.id, second.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: true, parallel: true },
    ] });
    const fakeRunner = (activeStore: StudioStore) => ({
      start: ({ cardId, agentId }: { cardId: string; agentId: string }) => {
        const worktree = ensureCardWorktree(activeStore, cardId);
        return reserveCardSession(activeStore, { cardId, agentId, worktreePath: worktree.path });
      },
      stop: (sessionId: string) => { activeStore.finishSession(sessionId, 'stopped', null); },
    }) as unknown as SessionRunner;
    const engine = new WorkflowEngine(store, fakeRunner(store));
    engine.setState({ id: flow.id, state: 'running' });
    const firstRuns = store.runningSessionsForProject(project.id).map((session) => session.id);
    expect(firstRuns).toHaveLength(2);
    engine.setState({ id: flow.id, state: 'paused' });
    expect(store.runningSessionsForProject(project.id)).toHaveLength(0);
    expect(store.workflowProgress(flow.id, 0).map((row) => row.state)).toEqual(['needs_review', 'needs_review']);
    store.close();

    const reopened = new StudioStore(dbPath);
    try {
      expect(reopened.workflow(flow.id).state).toBe('paused');
      expect(reopened.snapshot(project.id).sessions).toHaveLength(2);
      const resumed = new WorkflowEngine(reopened, fakeRunner(reopened));
      resumed.setState({ id: flow.id, state: 'running' });
      const newRuns = reopened.runningSessionsForProject(project.id);
      expect(newRuns).toHaveLength(2);
      expect(newRuns.every((session) => !firstRuns.includes(session.id))).toBe(true);
      for (const session of newRuns) {
        reopened.appendOutput(session.id, '[JARVIS_STEP_DONE]\n');
        reopened.finishSession(session.id, 'exited', 0);
        resumed.onSessionFinished(reopened.session(session.id));
      }
      expect(reopened.workflow(flow.id).state).toBe('done');
      expect(reopened.snapshot(project.id).sessions).toHaveLength(4);
    } finally { reopened.close(); }
  }, 35_000);

  it('runs a workflow agent in the persisted card worktree and leaves the project checkout unchanged', async () => {
    const { repository, dbPath, store, project, column, card, agent } = fixture();
    const flow = store.createWorkflow({ projectId: project.id, name: 'Isolated step', cardIds: [card.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: true },
    ] });
    expect(store.workflow(flow.id).steps[0]?.useWorktree).toBe(true);
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      await waitFor(() => store.workflow(flow.id).state === 'done');
      const session = store.snapshot(project.id).sessions.find((item) => item.cardId === card.id)!;
      expect(session.state).toBe('exited');
      expect(session.exitCode).toBe(0);
      expect(session.worktreePath).toBe(store.cardWorktree(card.id)?.path);
      expect(readFileSync(join(session.worktreePath!, 'worktree-result.txt'), 'utf8')).toBe('synthetic');
      expect(existsSync(join(repository, 'worktree-result.txt'))).toBe(false);
    } finally { runner.dispose(); store.close(); }
    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(flow.id).steps[0]?.useWorktree).toBe(true);
    expect(reopened.workflow(flow.id).state).toBe('done');
    expect(reopened.snapshot(project.id).sessions[0]?.worktreePath).toBe(reopened.cardWorktree(card.id)?.path);
    reopened.close();
  }, 30_000);

  it('keeps old steps on the project checkout and rejects invalid or agentless worktree choices', async () => {
    const { repository, store, project, column, card, agent } = fixture(false);
    expect(() => store.createWorkflow({ projectId: project.id, name: 'Invalid', cardIds: [card.id], steps: [
      { id: 'invalid', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: 'yes' as unknown as boolean },
    ] })).toThrow('Ja/Nein');
    expect(() => store.createWorkflow({ projectId: project.id, name: 'Manual', cardIds: [card.id], steps: [
      { id: 'manual', columnId: column.id, agentId: null, requireApproval: false, useWorktree: true },
    ] })).toThrow('manueller Schritt');
    expect(() => store.createWorkflow({ projectId: project.id, name: 'Parallel without worktree', cardIds: [card.id], steps: [
      { id: 'parallel', columnId: column.id, agentId: agent.id, requireApproval: false, parallel: true },
    ] })).toThrow('Karten-Worktrees');
    const flow = store.createWorkflow({ projectId: project.id, name: 'Legacy default', cardIds: [card.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false },
    ] });
    expect(store.workflow(flow.id).steps[0]?.useWorktree).toBe(false);
    let engine!: WorkflowEngine;
    const runner = new SessionRunner(store, () => undefined, (session, finalMessage) => engine.onSessionFinished(session, finalMessage));
    engine = new WorkflowEngine(store, runner);
    try {
      engine.setState({ id: flow.id, state: 'running' });
      await waitFor(() => store.workflow(flow.id).state === 'done');
      expect(store.snapshot(project.id).sessions[0]?.worktreePath).toBeNull();
      expect(readFileSync(join(repository, 'worktree-result.txt'), 'utf8')).toBe('synthetic');
      expect(store.cardWorktree(card.id)).toBeNull();
    } finally { runner.dispose(); store.close(); }
  }, 30_000);

  it('persists a prelaunch Git error for review, then clears it only after a deliberate successful resume', async () => {
    const { repository, dbPath, store, project, column, card, agent } = fixture(false);
    const template = store.createWorkflow({ projectId: project.id, name: 'Queue route', cardIds: [card.id], steps: [
      { id: 'execute', columnId: column.id, agentId: agent.id, requireApproval: false, useWorktree: true },
    ] });
    const cloneCard = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Queued card' });
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id, activeWorkflowId: null, pauseReason: null });
    const cloned = store.claimQueueCard(project.id, cloneCard.id, template.id);
    expect(cloned.steps[0]?.useWorktree).toBe(true);
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    const engine = new WorkflowEngine(store, runner);
    try {
      expect(() => engine.setState({ id: cloned.id, state: 'running' })).toThrow('Git-Repository');
      expect(store.workflow(cloned.id).state).toBe('paused');
      expect(store.workflow(cloned.id).startError?.message).toContain('Git-Repository');
      expect(globalInboxItems(store, { query: 'Git-Repository' }).items.some((item) => item.sourceId === cloned.id && item.detail.includes('Workflow-Start fehlgeschlagen'))).toBe(true);
      expect(store.latestSession(cloneCard.id)).toBeNull();
      expect(store.cardWorktree(cloneCard.id)).toBeNull();
    } finally { runner.dispose(); store.close(); }
    const reopened = new StudioStore(dbPath);
    expect(reopened.workflow(cloned.id).startError?.message).toContain('Git-Repository');
    git(repository, ['init', '-q']);
    writeFileSync(join(repository, 'tracked.txt'), 'original\n');
    git(repository, ['add', 'tracked.txt']);
    git(repository, ['-c', 'user.name=Studio Test', '-c', 'user.email=studio-test@example.invalid', 'commit', '-qm', 'Initial']);
    let resumedEngine!: WorkflowEngine;
    const resumedRunner = new SessionRunner(reopened, () => undefined, (session, finalMessage) => resumedEngine.onSessionFinished(session, finalMessage));
    resumedEngine = new WorkflowEngine(reopened, resumedRunner);
    try {
      resumedEngine.setState({ id: cloned.id, state: 'running' });
      await waitFor(() => reopened.workflow(cloned.id).state === 'done');
      expect(reopened.workflow(cloned.id).startError).toBeUndefined();
      expect(reopened.snapshot(project.id).sessions.find((item) => item.cardId === cloneCard.id)?.worktreePath).toBe(reopened.cardWorktree(cloneCard.id)?.path);
    } finally { resumedRunner.dispose(); reopened.close(); }
  }, 30_000);
});
