import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRunner } from '../../src/main/cli';
import { confirmTaskRevision, currentTaskRevisionContext, recordTaskRevisionInLaunch, submitTaskRevision, taskRevisionHistory } from '../../src/main/task-revisions';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-task-revision-'));
  roots.push(root);
  const db = join(root, 'studio.sqlite');
  const store = new StudioStore(db);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
    title: 'Export CSV and PDF', description: 'Build both formats.' });
  const agent = store.saveAgent({ name: 'Synthetic agent', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
  const expectedContentRevision = taskRevisionHistory(store, { projectId: project.id, cardId: card.id }).contentRevision;
  return { root, db, store, project, card, agent, expectedContentRevision };
}

function revised(f: ReturnType<typeof fixture>) {
  return confirmTaskRevision(f.store, { projectId: f.project.id, cardId: f.card.id,
    expectedContentRevision: f.expectedContentRevision, title: 'Export CSV', description: 'Only CSV is required.',
    reason: 'PDF is no longer in scope.' });
}

describe('confirmed task revisions', () => {
  it('keeps the old scope, new scope, reason and revision number after restart', () => {
    const f = fixture();
    try {
      const first = revised(f);
      expect(first.revisions[0]).toMatchObject({ number: 1, fromTitle: 'Export CSV and PDF',
        toTitle: 'Export CSV', fromDescription: 'Build both formats.', toDescription: 'Only CSV is required.',
        reason: 'PDF is no longer in scope.', delivery: 'prepared', sourceSessionId: null });
      expect(f.store.card(f.card.id).title).toBe('Export CSV');
      f.store.close();
      const reopened = new StudioStore(f.db);
      try {
        expect(taskRevisionHistory(reopened, { projectId: f.project.id, cardId: f.card.id }).revisions[0]).toEqual(first.revisions[0]);
        const second = confirmTaskRevision(reopened, { projectId: f.project.id, cardId: f.card.id,
          expectedContentRevision: first.contentRevision, title: 'Export CSV with header',
          description: 'Only CSV is required.', reason: 'The importer expects a header.' });
        expect(second.revisions.map((item) => item.number)).toEqual([2, 1]);
      } finally { reopened.close(); }
    } finally { if (f.store.db.open) f.store.close(); }
  });

  it('rejects stale drafts and unchanged scopes without partial writes', () => {
    const f = fixture();
    try {
      f.store.updateCard({ id: f.card.id, description: 'A newer edit.' });
      expect(() => revised(f)).toThrow('changed since');
      expect(taskRevisionHistory(f.store, { projectId: f.project.id, cardId: f.card.id }).revisions).toEqual([]);
      expect(() => confirmTaskRevision(f.store, { projectId: f.project.id, cardId: f.card.id,
        expectedContentRevision: taskRevisionHistory(f.store, { projectId: f.project.id, cardId: f.card.id }).contentRevision,
        title: f.card.title, description: 'A newer edit.', reason: 'No difference' })).toThrow('must change');
    } finally { f.store.close(); }
  });

  it('submits only to the running session present when the scope was revised', () => {
    const f = fixture();
    try {
      const source = f.store.createSession({ cardId: f.card.id, agentId: f.agent.id });
      const current = revised(f).revisions[0]!;
      expect(current.sourceSessionId).toBe(source.id);
      const send = vi.fn();
      const runner = { hasLiveProcess: (id: string) => id === source.id, send } as unknown as SessionRunner;
      expect(() => submitTaskRevision(f.store, runner, { projectId: 'other', cardId: f.card.id,
        revisionId: current.id, sessionId: source.id })).toThrow();
      const result = submitTaskRevision(f.store, runner, { projectId: f.project.id, cardId: f.card.id,
        revisionId: current.id, sessionId: source.id });
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0]![0]).toMatchObject({ sessionId: source.id });
      expect(send.mock.calls[0]![0].text).toContain('PDF is no longer in scope.');
      expect(result.revisions[0]).toMatchObject({ delivery: 'submitted', targetSessionId: source.id });
      expect(() => submitTaskRevision(f.store, runner, { projectId: f.project.id, cardId: f.card.id,
        revisionId: current.id, sessionId: source.id })).toThrow('stale or already submitted');
      f.store.close();
      const reopened = new StudioStore(f.db);
      try {
        expect(taskRevisionHistory(reopened, { projectId: f.project.id, cardId: f.card.id }).revisions[0])
          .toMatchObject({ id: current.id, delivery: 'submitted', targetSessionId: source.id,
            fromTitle: 'Export CSV and PDF', toTitle: 'Export CSV', reason: 'PDF is no longer in scope.' });
      } finally { reopened.close(); }
    } finally { if (f.store.db.open) f.store.close(); }
  });

  it('pauses a linked workflow and queue without stopping the running agent', () => {
    const f = fixture();
    try {
      const flow = f.store.createWorkflow({ projectId: f.project.id, name: 'Synthetic route', cardIds: [f.card.id],
        steps: [{ id: 'one', columnId: f.card.columnId, agentId: f.agent.id, requireApproval: false }] });
      f.store.setWorkflowState(flow.id, 'running');
      f.store.ensureWorkflowProgress(flow.id, 0, [f.card.id]);
      const source = f.store.createSession({ cardId: f.card.id, agentId: f.agent.id });
      f.store.beginWorkflowCard(flow.id, 0, f.card.id, source.id);
      f.store.saveProjectQueue({ projectId: f.project.id, state: 'running', templateWorkflowId: flow.id,
        activeWorkflowId: flow.id, pauseReason: null });
      revised(f);
      expect(f.store.session(source.id).state).toBe('running');
      expect(f.store.workflow(flow.id).state).toBe('paused');
      expect(f.store.projectQueue(f.project.id)).toMatchObject({ state: 'paused', activeWorkflowId: flow.id });
      f.store.finishSession(source.id, 'exited', 0);
      const engine = new WorkflowEngine(f.store, {} as SessionRunner);
      engine.onSessionFinished(f.store.session(source.id), 'Work is complete.\n[JARVIS_STEP_DONE]');
      expect(f.store.workflowProgress(flow.id, 0)).toMatchObject([{ cardId: f.card.id, state: 'needs_review' }]);
    } finally { f.store.close(); }
  });

  it('does not silently reroute an old revision to a replacement session', () => {
    const f = fixture();
    try {
      const first = f.store.createSession({ cardId: f.card.id, agentId: f.agent.id });
      const current = revised(f).revisions[0]!;
      f.store.finishSession(first.id, 'stopped', null);
      const replacement = f.store.createSession({ cardId: f.card.id, agentId: f.agent.id });
      const runner = { hasLiveProcess: () => true, send: vi.fn() } as unknown as SessionRunner;
      expect(() => submitTaskRevision(f.store, runner, { projectId: f.project.id, cardId: f.card.id,
        revisionId: current.id, sessionId: replacement.id })).toThrow('no longer running');
      expect(currentTaskRevisionContext(f.store, f.card.id)?.text).toContain('Only CSV is required.');
      recordTaskRevisionInLaunch(f.store, { revisionId: current.id, cardId: f.card.id, sessionId: replacement.id });
      expect(taskRevisionHistory(f.store, { projectId: f.project.id, cardId: f.card.id }).revisions[0])
        .toMatchObject({ delivery: 'included', targetSessionId: replacement.id });
    } finally { f.store.close(); }
  });

  it('blocks submission after a later card edit changes the confirmed scope', () => {
    const f = fixture();
    try {
      const source = f.store.createSession({ cardId: f.card.id, agentId: f.agent.id });
      const current = revised(f).revisions[0]!;
      f.store.updateCard({ id: f.card.id, description: 'A later different scope.' });
      const runner = { hasLiveProcess: () => true, send: vi.fn() } as unknown as SessionRunner;
      expect(() => submitTaskRevision(f.store, runner, { projectId: f.project.id, cardId: f.card.id,
        revisionId: current.id, sessionId: source.id })).toThrow('stale or already submitted');
      expect(currentTaskRevisionContext(f.store, f.card.id)).toBeNull();
    } finally { f.store.close(); }
  });

  it('leaves an uncertain write visibly unresolved after restart', () => {
    const f = fixture();
    try {
      const source = f.store.createSession({ cardId: f.card.id, agentId: f.agent.id });
      const current = revised(f).revisions[0]!;
      const runner = { hasLiveProcess: () => true, send: () => { throw new Error('PTY write failed'); } } as unknown as SessionRunner;
      expect(() => submitTaskRevision(f.store, runner, { projectId: f.project.id, cardId: f.card.id,
        revisionId: current.id, sessionId: source.id })).toThrow('PTY write failed');
      expect(taskRevisionHistory(f.store, { projectId: f.project.id, cardId: f.card.id }).revisions[0]?.delivery).toBe('uncertain');
      f.store.close();
      const reopened = new StudioStore(f.db);
      try { expect(taskRevisionHistory(reopened, { projectId: f.project.id, cardId: f.card.id }).revisions[0]?.delivery).toBe('uncertain'); }
      finally { reopened.close(); }
    } finally { if (f.store.db.open) f.store.close(); }
  });

  it('includes a prepared revision in a real new interactive PTY start', async () => {
    const f = fixture();
    const runner = new SessionRunner(f.store, () => undefined, () => undefined);
    try {
      const current = revised(f).revisions[0]!;
      f.store.saveAgent({ ...f.agent, args: ['-e', 'process.stdin.once("data", data => { console.log("REV_CONTEXT:" + data.toString()); process.exit(0); });'] });
      const session = runner.start({ cardId: f.card.id, agentId: f.agent.id, mode: 'interactive' });
      for (let attempt = 0; attempt < 50; attempt++) {
        if (taskRevisionHistory(f.store, { projectId: f.project.id, cardId: f.card.id }).revisions[0]?.delivery === 'included') break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(taskRevisionHistory(f.store, { projectId: f.project.id, cardId: f.card.id }).revisions[0])
        .toMatchObject({ id: current.id, delivery: 'included', targetSessionId: session.id });
      for (let attempt = 0; attempt < 30 && f.store.session(session.id).state === 'running'; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(f.store.session(session.id).output).toContain('PDF is no longer in scope.');
    } finally { runner.dispose(); f.store.close(); }
  }, 10_000);
});
