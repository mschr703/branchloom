import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { queueResults } from '../../src/main/queue-results';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) if (store.db.open) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

describe('project queue result sources', () => {
  it('reports only durable queue claims and links their actual session', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-queue-results-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    stores.push(store);
    const project = store.createProject({ name: 'Synthetic', path: root });
    const otherPath = join(root, 'other');
    mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    const todo = store.snapshot(project.id).columns[0]!;
    const executing = store.snapshot(project.id).columns[2]!;
    const agent = store.agents().find((item) => item.kind === 'codex')!;
    const templateCard = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Template' });
    const queued = store.createCard({ projectId: project.id, columnId: todo.id, title: '<Synthetic task>' });
    const manual = store.createCard({ projectId: project.id, columnId: todo.id, title: 'Manual card' });
    const template = store.createWorkflow({ projectId: project.id, name: 'Synthetic route', cardIds: [templateCard.id],
      steps: [{ id: 'execute', columnId: executing.id, agentId: agent.id, requireApproval: false }] });
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id, activeWorkflowId: null, pauseReason: null });
    const firstActivation = queueResults(store, project.id).latestActivation;
    expect(firstActivation).toMatchObject({ endedAt: null, endState: null, total: 0, continueBlocked: false });
    const flow = store.claimQueueCard(project.id, queued.id, template.id);
    expect(queueResults(store, project.id)).toMatchObject({ total: 1, counts: { pending: 1 },
      latestActivation: { id: firstActivation?.id, total: 1, counts: { pending: 1 } },
      items: [{ cardId: queued.id, activationId: firstActivation?.id, status: 'pending', lastSession: null }] });
    store.setWorkflowState(flow.id, 'running');
    store.ensureWorkflowProgress(flow.id, 0, [queued.id]);
    const session = store.createSession({ cardId: queued.id, agentId: agent.id });
    store.beginWorkflowCard(flow.id, 0, queued.id, session.id);
    const running = queueResults(store, project.id);
    expect(running.counts.running).toBe(1);
    expect(running.items[0]!.lastSession).toMatchObject({ id: session.id, state: 'running', exitCode: null });
    expect(running.items.some((item) => item.cardId === manual.id || item.cardId === templateCard.id)).toBe(false);
    expect(queueResults(store, other.id).total).toBe(0);
    store.finishSession(session.id, 'exited', 0);
    store.finishWorkflowCard(session.id, true);
    store.advanceWorkflow(flow.id);
    const completed = queueResults(store, project.id);
    expect(completed).toMatchObject({ total: 1, counts: { done: 1 }, items: [{ status: 'done', lastSession: { id: session.id, state: 'exited', exitCode: 0 }, integration: null, test: null }] });
    const sourceHead = 'a'.repeat(40);
    const targetHead = 'b'.repeat(40);
    const timestamp = new Date().toISOString();
    const receipt = store.db.prepare(`INSERT INTO integration_items
      (project_id, card_id, repository_key, target_branch, source_head, target_head, card_fingerprint,
        state, reason, created_at, updated_at, integrated_head, approval_mode)
      VALUES (@projectId, @cardId, 'synthetic', 'main', @sourceHead, @targetHead, 'fingerprint',
        'integrated', NULL, @timestamp, @timestamp, @sourceHead, 'manual')`)
      .run({ projectId: project.id, cardId: queued.id, sourceHead, targetHead, timestamp });
    store.db.prepare(`INSERT INTO integration_test_runs
      (item_id, card_id, source_head, target_head, card_fingerprint, script_name, script_hash,
        state, exit_code, output_tail, started_at, ended_at)
      VALUES (?, ?, ?, ?, 'fingerprint', 'test', 'script-hash', 'passed', 0, 'synthetic pass', ?, ?)`)
      .run(receipt.lastInsertRowid, queued.id, sourceHead, targetHead, timestamp, timestamp);
    expect(queueResults(store, project.id).items[0]).toMatchObject({
      integration: { id: receipt.lastInsertRowid, state: 'integrated', sourceHead, targetBranch: 'main', integratedHead: sourceHead, approvalMode: 'manual' },
      test: { state: 'passed', scriptName: 'test', sourceHead, targetHead, endedAt: timestamp },
    });
    expect(queueResults(store, other.id).items).toEqual([]);
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id, activeWorkflowId: null, pauseReason: null });
    const secondFlow = store.claimQueueCard(project.id, manual.id, template.id);
    store.setWorkflowState(secondFlow.id, 'paused');
    expect(queueResults(store, project.id).counts['needs-attention']).toBe(1);
    store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: template.id, activeWorkflowId: secondFlow.id, pauseReason: 'Needs input' });
    expect(queueResults(store, project.id).latestActivation).toMatchObject({ id: firstActivation?.id, endState: 'paused', endReason: 'Needs input', total: 2 });
    store.skipQueuedCard({ projectId: project.id, workflowId: secondFlow.id, reason: 'Needs input' });
    expect(queueResults(store, project.id)).toMatchObject({ total: 2, counts: { done: 1, skipped: 1 } });
    store.close();
    const reopened = new StudioStore(join(root, 'studio.sqlite'));
    stores.push(reopened);
    expect(queueResults(reopened, project.id).counts).toMatchObject({ done: 1, skipped: 1 });
    expect(queueResults(reopened, project.id).latestActivation).toMatchObject({ id: firstActivation?.id, endState: 'paused', total: 2 });
    expect(queueResults(reopened, project.id).items.find((item) => item.cardId === queued.id)).toMatchObject({
      integration: { state: 'integrated', sourceHead }, test: { state: 'passed', sourceHead },
    });
    reopened.close();
  });

  it('keeps distinct start windows and closes an interrupted window without replaying its card', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-queue-activation-'));
    roots.push(root);
    const dbPath = join(root, 'studio.sqlite');
    const store = new StudioStore(dbPath);
    stores.push(store);
    const project = store.createProject({ name: 'Synthetic', path: root });
    const columns = store.snapshot(project.id).columns;
    const agent = store.agents().find((item) => item.kind === 'codex')!;
    const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'One queued card' });
    const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template' });
    const template = store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [templateCard.id],
      steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
    const deadline = new Date(Date.now() + 60_000).toISOString();
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id,
      activeWorkflowId: null, pauseReason: null, runUntil: deadline });
    const first = queueResults(store, project.id).latestActivation!;
    expect(first).toMatchObject({ runUntil: deadline, total: 0, endedAt: null });
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id,
      activeWorkflowId: null, pauseReason: null });
    expect(queueResults(store, project.id).latestActivation?.id).toBe(first.id);
    store.db.prepare("UPDATE project_queues SET state = 'paused', pause_reason = 'Safe pause', updated_at = ? WHERE project_id = ?")
      .run(new Date().toISOString(), project.id);
    expect(queueResults(store, project.id).latestActivation).toMatchObject({ id: first.id, endState: 'paused', endReason: 'Safe pause' });

    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id,
      activeWorkflowId: null, pauseReason: null, runUntil: null });
    const second = queueResults(store, project.id).latestActivation!;
    expect(second.id).not.toBe(first.id);
    expect(second.runUntil).toBeNull();
    const flow = store.claimQueueCard(project.id, card.id, template.id);
    expect(queueResults(store, project.id).items[0]).toMatchObject({ workflowId: flow.id, activationId: second.id });
    store.close();
    const reopened = new StudioStore(dbPath);
    stores.push(reopened);
    expect(queueResults(reopened, project.id).latestActivation).toMatchObject({ id: second.id, endState: 'paused', total: 1 });
    expect(reopened.projectQueue(project.id).state).toBe('paused');
    reopened.close();
  });

  it('separates the latest start from earlier claims without hiding the project history', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-queue-start-report-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    stores.push(store);
    const project = store.createProject({ name: 'Synthetic', path: root });
    const columns = store.snapshot(project.id).columns;
    const agent = store.agents().find((item) => item.kind === 'codex')!;
    const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template' });
    const firstCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Earlier card' });
    const secondCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Current card' });
    const template = store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [templateCard.id],
      steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
    const start = () => store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id,
      activeWorkflowId: null, pauseReason: null });
    start();
    const first = store.claimQueueCard(project.id, firstCard.id, template.id);
    store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: template.id,
      activeWorkflowId: first.id, pauseReason: 'First stopped' });
    start();
    const second = store.claimQueueCard(project.id, secondCard.id, template.id);
    const report = queueResults(store, project.id);
    expect(report).toMatchObject({ total: 2, latestActivation: { total: 1 }, latestTruncated: false,
      latestItems: [{ cardId: secondCard.id, workflowId: second.id }] });
    expect(report.items.map((item) => item.cardId).sort()).toEqual([firstCard.id, secondCard.id].sort());
    expect(report.latestItems.some((item) => item.cardId === firstCard.id)).toBe(false);
  });
});
