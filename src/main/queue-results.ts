import type { QueueActivationSummary, QueueResultItem, QueueResultStatus, QueueResults } from '../shared/queue-results';
import type { SessionState } from '../shared/types';
import type { StudioStore } from './store';

const STATUS_SQL = `CASE
  WHEN skip.workflow_id IS NOT NULL THEN 'skipped'
  WHEN w.state = 'done' AND w.current_step >= json_array_length(w.steps_json) THEN 'done'
  WHEN w.state = 'running' THEN 'running'
  WHEN w.state = 'draft' THEN 'pending'
  ELSE 'needs-attention' END`;

function emptyCounts(): QueueResults['counts'] {
  return { done: 0, 'needs-attention': 0, running: 0, skipped: 0, pending: 0 };
}

function resultItems(store: StudioStore, projectId: string, activationId: string | null): QueueResultItem[] {
  const rows = store.db.prepare(`SELECT q.card_id AS card_id, q.workflow_id AS workflow_id, q.activation_id AS activation_id, c.title AS card_title,
    w.name AS workflow_name, w.updated_at AS updated_at, ${STATUS_SQL} AS status
    FROM queue_runs q JOIN workflows w ON w.id = q.workflow_id JOIN cards c ON c.id = q.card_id
    LEFT JOIN queue_run_skips skip ON skip.workflow_id = w.id
    WHERE q.project_id = ? ${activationId === null ? '' : 'AND q.activation_id = ?'}
    ORDER BY w.created_at DESC, w.id DESC LIMIT 100`).all(...(activationId === null ? [projectId] : [projectId, activationId])) as Array<{
      card_id: string; workflow_id: string; activation_id: string | null; card_title: string; workflow_name: string; updated_at: string; status: QueueResultStatus;
    }>;
  const latestSession = store.db.prepare(`SELECT s.id, s.state, s.exit_code FROM session_usage_origins o
    JOIN sessions s ON s.id = o.session_id WHERE o.workflow_id = ? AND s.card_id = ?
    ORDER BY s.started_at DESC, s.id DESC LIMIT 1`);
  return rows.map((row) => {
    const session = latestSession.get(row.workflow_id, row.card_id) as { id: string; state: SessionState; exit_code: number | null } | undefined;
    return { cardId: row.card_id, cardTitle: row.card_title, workflowId: row.workflow_id, workflowName: row.workflow_name,
      activationId: row.activation_id, status: row.status, updatedAt: row.updated_at,
      lastSession: session ? { id: session.id, state: session.state, exitCode: session.exit_code } : null };
  });
}

/** Read-only history and latest activation slice; neither infers test nor Git outcomes. */
export function queueResults(store: StudioStore, projectId: string): QueueResults {
  store.project(projectId);
  const counts = emptyCounts();
  const grouped = store.db.prepare(`SELECT ${STATUS_SQL} AS status, COUNT(*) AS count
    FROM queue_runs q JOIN workflows w ON w.id = q.workflow_id
    LEFT JOIN queue_run_skips skip ON skip.workflow_id = w.id
    WHERE q.project_id = ? GROUP BY status`).all(projectId) as Array<{ status: QueueResultStatus; count: number }>;
  for (const row of grouped) counts[row.status] = row.count;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const items = resultItems(store, projectId, null);

  const activation = store.db.prepare(`SELECT id, started_at, ended_at, end_state, end_reason,
    run_until, continue_blocked FROM queue_activations WHERE project_id = ? ORDER BY rowid DESC LIMIT 1`)
    .get(projectId) as {
      id: string; started_at: string; ended_at: string | null; end_state: 'paused' | 'off' | null;
      end_reason: string | null; run_until: string | null; continue_blocked: number;
    } | undefined;
  let latestActivation: QueueActivationSummary | null = null;
  let latestItems: QueueResultItem[] = [];
  if (activation) {
    const activationCounts = emptyCounts();
    const activationGroups = store.db.prepare(`SELECT ${STATUS_SQL} AS status, COUNT(*) AS count
      FROM queue_runs q JOIN workflows w ON w.id = q.workflow_id
      LEFT JOIN queue_run_skips skip ON skip.workflow_id = w.id
      WHERE q.project_id = ? AND q.activation_id = ? GROUP BY status`)
      .all(projectId, activation.id) as Array<{ status: QueueResultStatus; count: number }>;
    for (const row of activationGroups) activationCounts[row.status] = row.count;
    latestActivation = {
      id: activation.id, startedAt: activation.started_at, endedAt: activation.ended_at,
      endState: activation.end_state, endReason: activation.end_reason,
      runUntil: activation.run_until, continueBlocked: activation.continue_blocked === 1,
      counts: activationCounts,
      total: Object.values(activationCounts).reduce((sum, count) => sum + count, 0),
    };
    latestItems = resultItems(store, projectId, activation.id);
  }
  return { projectId, total, truncated: total > items.length, counts, items, latestActivation,
    latestItems, latestTruncated: (latestActivation?.total ?? 0) > latestItems.length };
}
