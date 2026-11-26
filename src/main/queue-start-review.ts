import { createHash } from 'node:crypto';
import type { ProjectQueue } from '../shared/types';
import { queueStartReview, type QueueStartReview } from '../shared/queue-start-review';
import { integrationPolicy } from './integration-queue';
import { projectCodexWorkflowAccess } from './project-agent-rights';
import type { ProjectQueueEngine } from './queue';
import type { StudioStore } from './store';

export function queueStartPreview(store: StudioStore, input: { projectId: string; templateWorkflowId: string; durationHours: 0 | 1 | 4 | 8 }): QueueStartReview {
  if (!input || typeof input.projectId !== 'string' || typeof input.templateWorkflowId !== 'string')
    throw new Error('Choose a project and workflow route before starting the queue.');
  if (![0, 1, 4, 8].includes(input.durationHours)) throw new Error('Choose a valid queue duration.');
  const snapshot = store.snapshot(input.projectId);
  const candidates = snapshot.queue.continueBlocked
    ? store.runnableQueueCandidates(input.projectId, 5)
    : store.queueCandidates(input.projectId, 5);
  const codex = projectCodexWorkflowAccess(store, input.projectId);
  const integration = integrationPolicy(store, input.projectId);
  const review = queueStartReview(snapshot, input.templateWorkflowId, candidates, codex, integration, input.durationHours);
  const dependencies = store.db.prepare(`SELECT d.child_card_id, d.prerequisite_card_id, d.created_at
    FROM card_run_dependencies d JOIN cards c ON c.id = d.child_card_id
    WHERE c.project_id = ? ORDER BY d.child_card_id, d.prerequisite_card_id`).all(input.projectId);
  const approvals = store.db.prepare(`SELECT a.child_card_id, a.prerequisite_card_id, a.qa_report_id, a.approved_at
    FROM card_dependency_approvals_v2 a JOIN cards c ON c.id = a.child_card_id
    WHERE c.project_id = ? ORDER BY a.child_card_id, a.prerequisite_card_id`).all(input.projectId);
  const autoTest = store.db.prepare('SELECT auto_test_script_hash AS hash FROM project_queues WHERE project_id = ?')
    .get(input.projectId) as { hash: string | null } | undefined;
  const testConfig = store.db.prepare('SELECT script_name FROM integration_test_config WHERE project_id = ?')
    .get(input.projectId) as { script_name: string } | undefined;
  const token = createHash('sha256').update(JSON.stringify({ review, project: snapshot.project,
    columns: snapshot.columns, cards: snapshot.cards, workflows: snapshot.workflows, agents: snapshot.agents,
    queue: snapshot.queue, runPause: snapshot.runPause, dependencies, approvals, codex, integration,
    autoTestScriptHash: autoTest?.hash ?? null, testScript: testConfig?.script_name ?? null })).digest('hex');
  return { ...review, token };
}

/** Compare and start synchronously in one main-process event turn; a changed review never claims a card. */
export function startReviewedProjectQueue(store: StudioStore, engine: ProjectQueueEngine,
  input: { projectId: string; state: ProjectQueue['state']; templateWorkflowId?: string; runUntil?: string | null;
    durationHours?: 0 | 1 | 4 | 8; reviewToken?: string }): ProjectQueue {
  if (!input || typeof input.projectId !== 'string') throw new Error('Choose a project before changing its queue.');
  if (input.state !== 'running') return engine.setState(input);
  if (typeof input.reviewToken !== 'string' || !/^[0-9a-f]{64}$/.test(input.reviewToken) || !input.templateWorkflowId)
    throw new Error('Open the current queue start review before starting.');
  if (input.runUntil !== undefined) throw new Error('Queue duration must come from the reviewed start options.');
  if (![0, 1, 4, 8].includes(input.durationHours as number)) throw new Error('Choose a valid queue duration.');
  const current = queueStartPreview(store, { projectId: input.projectId, templateWorkflowId: input.templateWorkflowId,
    durationHours: input.durationHours! });
  if (current.token !== input.reviewToken)
    throw new Error('Project, route or queue settings changed. Reload the start review before starting.');
  if (current.queueState === 'running') throw new Error('The queue is already running. Pause it before reviewing a new start.');
  const runUntil = input.durationHours ? new Date(Date.now() + input.durationHours * 60 * 60 * 1_000).toISOString() : null;
  return engine.setState({ projectId: input.projectId, state: 'running', templateWorkflowId: input.templateWorkflowId, runUntil });
}
