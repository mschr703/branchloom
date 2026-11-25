import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('usage session read', () => {
  it('reads project-scoped metadata for more than 200 stored sessions without disclosing output', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-usage-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    try {
      const project = store.createProject({ name: 'Synthetic usage', path: root });
      mkdirSync(join(root, 'other'));
      const other = store.createProject({ name: 'Other', path: join(root, 'other') });
      const agent = store.agents()[0]!;
      const column = store.snapshot(project.id).columns[0]!;
      const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Synthetic task' });
      const otherCard = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Other task' });
      const first = store.createSession({ cardId: card.id, agentId: agent.id });
      store.appendOutput(first.id, 'PRIVATE TOKEN MUST NOT LEAK');
      store.finishSession(first.id, 'failed', 1);
      for (let i = 0; i < 201; i += 1) {
        const run = store.createSession({ cardId: card.id, agentId: agent.id });
        store.finishSession(run.id, 'exited', 0);
      }
      store.createSession({ cardId: otherCard.id, agentId: agent.id });
      expect(store.snapshot(project.id).sessions).toHaveLength(200);
      const page = store.usageSessions({ projectId: project.id, since: new Date(Date.now() - 86_400_000).toISOString() });
      expect(page).toMatchObject({ truncated: false });
      expect(page.sessions).toHaveLength(202);
      expect(page.sessions.find((run) => run.id === first.id)).toMatchObject({
        state: 'failed', exitCode: 1, cardId: card.id, cardTitle: 'Synthetic task',
      });
      expect(page.sessions.every((run) => run.cardId === card.id && run.cardTitle === 'Synthetic task')).toBe(true);
      expect(JSON.stringify(page)).not.toContain('PRIVATE TOKEN');
      expect(page.sessions.every((run) => !('output' in run))).toBe(true);
      expect(store.usageSessions({ projectId: other.id, since: new Date(Date.now() - 86_400_000).toISOString() }).sessions).toHaveLength(1);
      expect(() => store.usageSessions({ projectId: project.id, since: 'not-a-date' })).toThrow();
      expect(() => store.usageSessions({ projectId: project.id, since: new Date(Date.now() - 36 * 86_400_000).toISOString() })).toThrow();
      expect(() => store.usageSessions({ projectId: 'missing', since: new Date(Date.now() - 86_400_000).toISOString() })).toThrow();
    } finally { store.close(); }
  });

  it('keeps start attribution after restart and backfills only provable older workflow links', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-usage-origin-'));
    roots.push(root);
    const file = join(root, 'studio.sqlite');
    let store = new StudioStore(file);
    const project = store.createProject({ name: 'Usage origins', path: root });
    const column = store.snapshot(project.id).columns[0]!;
    const agent = store.agents()[0]!;
    const directCard = store.createCard({ projectId: project.id, columnId: column.id, title: 'Direct' });
    const flowCard = store.createCard({ projectId: project.id, columnId: column.id, title: 'Workflow' });
    const queueCard = store.createCard({ projectId: project.id, columnId: column.id, title: 'Queue' });
    const direct = store.createSession({ cardId: directCard.id, agentId: agent.id });
    const flow = store.createWorkflow({ projectId: project.id, name: 'Review route', cardIds: [flowCard.id], steps: [
      { id: 'run', columnId: column.id, agentId: agent.id, requireApproval: false },
    ] });
    store.ensureWorkflowProgress(flow.id, 0, [flowCard.id]);
    const linked = store.createSession({ cardId: flowCard.id, agentId: agent.id });
    store.beginWorkflowCard(flow.id, 0, flowCard.id, linked.id);
    const queue = store.createWorkflow({ projectId: project.id, name: 'Automatic queue', cardIds: [queueCard.id], steps: [
      { id: 'run', columnId: column.id, agentId: agent.id, requireApproval: false },
    ] });
    store.db.prepare('INSERT INTO queue_runs (project_id, card_id, workflow_id) VALUES (?, ?, ?)').run(project.id, queueCard.id, queue.id);
    store.ensureWorkflowProgress(queue.id, 0, [queueCard.id]);
    const queued = store.createSession({ cardId: queueCard.id, agentId: agent.id });
    store.beginWorkflowCard(queue.id, 0, queueCard.id, queued.id);
    store.appendOutput(linked.id, 'PRIVATE TERMINAL TEXT');
    const read = () => new Map(store.usageSessions({ projectId: project.id, since: new Date(Date.now() - 86_400_000).toISOString() }).sessions.map((item) => [item.id, item]));
    expect(read().get(direct.id)).toMatchObject({ origin: 'direct', workflowId: null });
    expect(read().get(linked.id)).toMatchObject({ origin: 'workflow', workflowId: flow.id, workflowName: 'Review route' });
    expect(read().get(queued.id)).toMatchObject({ origin: 'queue', workflowId: queue.id, workflowName: 'Automatic queue' });
    expect(JSON.stringify([...read().values()])).not.toContain('PRIVATE TERMINAL TEXT');
    store.close();
    store = new StudioStore(file);
    expect(read().get(linked.id)?.origin).toBe('workflow');
    expect(read().get(queued.id)?.origin).toBe('queue');
    store.db.exec('DROP TABLE session_usage_origins');
    store.close();
    store = new StudioStore(file);
    expect(read().get(direct.id)?.origin).toBe('unknown');
    expect(read().get(linked.id)?.origin).toBe('workflow');
    expect(read().get(queued.id)?.origin).toBe('queue');
    store.close();
  });
});
