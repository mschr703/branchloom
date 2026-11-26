import type { GlobalInboxItem, GlobalInboxPage, GlobalInboxQuery } from '../shared/global-inbox';
import type { StudioStore } from './store';

const PAGE_SIZE = 100;
const MAX_OFFSET = 9_900;

type Row = {
  id: string; kind: GlobalInboxItem['kind']; category: GlobalInboxItem['category'];
  project_id: string; project_name: string; source_id: string; title: string;
  detail: string; recorded_at: string;
};

/** Read persisted, still-open sources across local projects. This never approves or starts work. */
export function globalInboxItems(store: StudioStore, input: GlobalInboxQuery = {}): GlobalInboxPage {
  if (!input || typeof input !== 'object' ||
    (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) ||
    (input.category !== undefined && !['all', 'approval', 'manual', 'review', 'paused'].includes(input.category)) ||
    (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > MAX_OFFSET || input.offset % PAGE_SIZE !== 0))) {
    throw new Error('Ungültige projektübergreifende Inbox-Abfrage.');
  }
  const query = (input.query?.trim() ?? '').normalize('NFKC').toLocaleLowerCase('de-DE');
  const category = input.category ?? 'all';
  const offset = input.offset ?? 0;
  const rows = store.db.prepare(`WITH all_items AS (
    SELECT 'workflow:' || w.id AS id, 'workflow' AS kind,
      CASE
        WHEN json_extract(w.steps_json, '$[' || w.current_step || '].requireApproval') = 1
          AND NOT EXISTS (SELECT 1 FROM workflow_step_approvals a WHERE a.workflow_id = w.id AND a.step_index = w.current_step) THEN 'approval'
        WHEN EXISTS (SELECT 1 FROM workflow_progress wp WHERE wp.workflow_id = w.id AND wp.step_index = w.current_step AND wp.state = 'manual_wait') THEN 'manual'
        WHEN EXISTS (SELECT 1 FROM workflow_progress wp WHERE wp.workflow_id = w.id AND wp.step_index = w.current_step AND wp.state = 'needs_review') THEN 'review'
        ELSE 'paused' END AS category,
      p.id AS project_id, p.name AS project_name, w.id AS source_id,
      substr(w.name, 1, 160) AS title,
      CASE WHEN start_error.message IS NOT NULL THEN 'Workflow-Start fehlgeschlagen: ' || substr(start_error.message, 1, 300)
        ELSE 'Workflow ist pausiert; Verlauf vor Fortsetzung prüfen.' END AS detail, w.updated_at AS recorded_at
    FROM workflows w JOIN projects p ON p.id = w.project_id
    LEFT JOIN queue_run_skips skipped ON skipped.workflow_id = w.id
    LEFT JOIN workflow_start_errors start_error ON start_error.workflow_id = w.id
    WHERE w.state = 'paused' AND skipped.workflow_id IS NULL
    UNION ALL
    SELECT 'queue:' || q.project_id, 'queue', 'paused',
      p.id, p.name, q.project_id, 'Warteschlange pausiert',
      substr(coalesce(nullif(trim(q.pause_reason), ''), 'Route und aktiven Ablauf vor dem Fortsetzen prüfen.'), 1, 300),
      q.updated_at
    FROM project_queues q JOIN projects p ON p.id = q.project_id
    WHERE q.state = 'paused'
    UNION ALL
    SELECT 'session:' || s.id, 'session', 'review',
      p.id, p.name, s.id, 'Unterbrochener Agentenlauf: ' || substr(c.title, 1, 140),
      'Gespeicherten Verlauf und Projektdateien prüfen; kein automatischer Neustart.',
      s.interrupted_at
    FROM sessions s JOIN projects p ON p.id = s.project_id
      JOIN cards c ON c.id = s.card_id AND c.project_id = s.project_id
    WHERE s.interrupted_at IS NOT NULL AND s.interruption_reviewed_at IS NULL
    UNION ALL
    SELECT 'plan:' || pc.id, 'plan', 'review',
      p.id, p.name, rp.id, substr(rp.request, 1, 160),
      'Planzeile ' || pc.line || ': ' || substr(pc.text, 1, 120) || ' · ' || substr(pc.body, 1, 240),
      pc.created_at
    FROM plan_comments pc JOIN reviewed_plans rp ON rp.id = pc.plan_id
      JOIN projects p ON p.id = rp.project_id
    LEFT JOIN review_inbox_acknowledgements ack ON ack.project_id = p.id AND ack.kind = 'plan' AND ack.comment_id = pc.id
    WHERE rp.state = 'open' AND ack.comment_id IS NULL
    UNION ALL
    SELECT 'diff:' || rc.id, 'diff', 'review',
      p.id, p.name, c.id, substr(c.title, 1, 160),
      'Diff ' || substr(rc.file_path, 1, 160) || ':' || rc.line || ' · ' || substr(rc.body, 1, 240),
      rc.created_at
    FROM review_comments rc JOIN cards c ON c.id = rc.card_id
      JOIN projects p ON p.id = c.project_id
    LEFT JOIN review_inbox_acknowledgements ack ON ack.project_id = p.id AND ack.kind = 'diff' AND ack.comment_id = rc.id
    WHERE c.archived_at IS NULL AND ack.comment_id IS NULL
    UNION ALL
    SELECT 'qa:' || q.id, 'qa', 'review',
      p.id, p.name, c.id, substr(c.title, 1, 160),
      CASE WHEN q.status = 'failed' THEN 'Browser-QA · Fehler: ' ||
        CASE WHEN json_valid(q.diagnostics_json) THEN substr(coalesce(json_extract(q.diagnostics_json, '$[0].message'), 'Keine Diagnose gespeichert.'), 1, 240) ELSE 'Diagnose nicht lesbar.' END
        ELSE 'Browser-QA · Abbruch: ' || substr(coalesce(q.note, 'Keine Details gespeichert.'), 1, 240) END,
      q.ended_at
    FROM card_qa_reports q JOIN cards c ON c.id = q.card_id AND c.project_id = q.project_id
      JOIN projects p ON p.id = q.project_id
    LEFT JOIN qa_inbox_acknowledgements ack ON ack.project_id = p.id AND ack.report_id = q.id
    WHERE q.status IN ('failed','error') AND c.archived_at IS NULL AND ack.report_id IS NULL
    UNION ALL
    SELECT 'guest:' || tc.id, 'guest', 'review',
      p.id, p.name, c.id, substr(c.title, 1, 160),
      'Gastfeedback von ' || substr(tc.display_name, 1, 80) || ': ' || tc.body,
      tc.created_at
    FROM team_board_comments tc JOIN cards c ON c.id = tc.card_id AND c.project_id = tc.project_id
      JOIN projects p ON p.id = tc.project_id
    LEFT JOIN guest_inbox_acknowledgements ack ON ack.project_id = tc.project_id AND ack.comment_id = tc.id
    WHERE c.archived_at IS NULL AND ack.comment_id IS NULL
  )
  SELECT * FROM all_items
  WHERE (? = '' OR instr(review_search_fold(project_name), ?) > 0 OR instr(review_search_fold(title), ?) > 0 OR instr(review_search_fold(detail), ?) > 0)
    AND (? = 'all' OR category = ?)
  ORDER BY recorded_at DESC, id DESC LIMIT ? OFFSET ?`).all(query, query, query, query, category, category, PAGE_SIZE + 1, offset) as Row[];
  return {
    items: rows.slice(0, PAGE_SIZE).map((row) => ({
      id: row.id, kind: row.kind, category: row.category,
      projectId: row.project_id, projectName: row.project_name, sourceId: row.source_id,
      title: row.title, detail: row.detail, recordedAt: row.recorded_at,
    })),
    hasMore: rows.length > PAGE_SIZE && offset < MAX_OFFSET,
    limitReached: rows.length > PAGE_SIZE && offset >= MAX_OFFSET,
  };
}
