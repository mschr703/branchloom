import type { QueueResultItem, QueueResultStatus, QueueResults } from '../shared/queue-results';
import type { SessionState } from '../shared/types';
import type { StudioStore } from './store';

const STATUS_SQL = `CASE
  WHEN skip.workflow_id IS NOT NULL THEN 'skipped'
  WHEN w.state = 'done' AND w.current_step >= json_array_length(w.steps_json) THEN 'done'
  WHEN w.state = 'running' THEN 'running'
  WHEN w.state = 'draft' THEN 'pending'
  ELSE 'needs-attention' END`;

/** Read-only, source-linked history. This is not an inferred agent summary or a single-run report. */
export function queueResults(store: StudioStore, projectId: string): QueueResults {
  store.project(projectId);
  const counts: QueueResults['counts'] = { done: 0, 'needs-attention': 0, running: 0, skipped: 0, pending: 0 };
  const grouped = store.db.prepare(`SELECT ${STATUS_SQL} AS status, COUNT(*) AS count
    FROM queue_runs q JOIN workflows w ON w.id = q.workflow_id
    LEFT JOIN queue_run_skips skip ON skip.workflow_id = w.id
    WHERE q.project_id = ? GROUP BY status`).all(projectId) as Array<{ status: QueueResultStatus; count: number }>;
  for (const row of grouped) counts[row.status] = row.count;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const rows = store.db.prepare(`SELECT q.card_id AS card_id, q.workflow_id AS workflow_id, c.title AS card_title,
    w.name AS workflow_name, w.updated_at AS updated_at, ${STATUS_SQL} AS status
    FROM queue_runs q JOIN workflows w ON w.id = q.workflow_id JOIN cards c ON c.id = q.card_id
    LEFT JOIN queue_run_skips skip ON skip.workflow_id = w.id
    WHERE q.project_id = ? ORDER BY w.created_at DESC, w.id DESC LIMIT 100`).all(projectId) as Array<{
      card_id: string; workflow_id: string; card_title: string; workflow_name: string; updated_at: string; status: QueueResultStatus;
    }>;
  const latestSession = store.db.prepare(`SELECT s.id, s.state, s.exit_code FROM session_usage_origins o
    JOIN sessions s ON s.id = o.session_id WHERE o.workflow_id = ? AND s.card_id = ?
    ORDER BY s.started_at DESC, s.id DESC LIMIT 1`);
  const items: QueueResultItem[] = rows.map((row) => {
    const session = latestSession.get(row.workflow_id, row.card_id) as { id: string; state: SessionState; exit_code: number | null } | undefined;
    return { cardId: row.card_id, cardTitle: row.card_title, workflowId: row.workflow_id, workflowName: row.workflow_name,
      status: row.status, updatedAt: row.updated_at,
      lastSession: session ? { id: session.id, state: session.state, exitCode: session.exit_code } : null };
  });
  return { projectId, total, truncated: total > items.length, counts, items };
}
