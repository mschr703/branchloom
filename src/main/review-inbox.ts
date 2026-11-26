import type Database from 'better-sqlite3';
import type { AcknowledgeGuestInboxComment, AcknowledgeQaInboxReport, AcknowledgeReviewInboxComment, ReviewInboxItem, ReviewInboxPage, ReviewInboxQuery, ReviewInboxSource } from '../shared/review-inbox';
import type { StudioStore } from './store';

const LIMIT = 100;
type Row = { id: string; kind: ReviewInboxSource; project_id: string; source_id: string; source_title: string; location: string; body: string; created_at: string; qa_status: 'failed' | 'error' | null };
const fromRow = (row: Row): ReviewInboxItem => ({ id: row.id, kind: row.kind, projectId: row.project_id, sourceId: row.source_id,
  sourceTitle: row.source_title, location: row.location, body: row.body, createdAt: row.created_at,
  ...(row.qa_status ? { qaStatus: row.qa_status } : {}) });

export function installReviewInbox(db: Database.Database): void {
  db.function('review_search_fold', { deterministic: true }, (value: string) => value.normalize('NFKC').toLocaleLowerCase('de-DE'));
  db.exec(`CREATE TABLE IF NOT EXISTS review_inbox_acknowledgements (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('plan','diff')),
    comment_id TEXT NOT NULL, acknowledged_at TEXT NOT NULL,
    PRIMARY KEY(project_id, kind, comment_id)
  ); CREATE TABLE IF NOT EXISTS qa_inbox_acknowledgements (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    report_id TEXT NOT NULL REFERENCES card_qa_reports(id) ON DELETE CASCADE,
    acknowledged_at TEXT NOT NULL,
    PRIMARY KEY(project_id, report_id)
  ); CREATE TABLE IF NOT EXISTS guest_inbox_acknowledgements (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    comment_id TEXT NOT NULL REFERENCES team_board_comments(id) ON DELETE CASCADE,
    acknowledged_at TEXT NOT NULL,
    PRIMARY KEY(project_id, comment_id)
  );`);
}

/** Read bounded, unacknowledged review comments and failed local QA for one project. */
export function reviewInboxItems(store: StudioStore, input: ReviewInboxQuery): ReviewInboxPage {
  if (!input || typeof input.projectId !== 'string' || (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200))
    || (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0))) throw new Error('Ungültige Review-Inbox-Abfrage.');
  const projectId = input.projectId;
  const query = (input.query?.trim() ?? '').normalize('NFKC').toLocaleLowerCase('de-DE');
  store.project(projectId);
  const rows = store.db.prepare(`SELECT * FROM (
    SELECT pc.id, 'plan' AS kind, p.project_id, p.id AS source_id,
      substr(p.request, 1, 120) AS source_title,
      'Planzeile ' || pc.line || ': ' || substr(pc.text, 1, 120) AS location,
      pc.body, pc.created_at, NULL AS qa_status
    FROM plan_comments pc JOIN reviewed_plans p ON p.id = pc.plan_id
    LEFT JOIN review_inbox_acknowledgements ack ON ack.project_id = p.project_id AND ack.kind = 'plan' AND ack.comment_id = pc.id
    WHERE p.project_id = ? AND p.state = 'open' AND ack.comment_id IS NULL
    UNION ALL
    SELECT rc.id, 'diff' AS kind, c.project_id, c.id AS source_id,
      c.title AS source_title, 'Diff ' || rc.file_path || ':' || rc.line AS location,
      rc.body, rc.created_at, NULL AS qa_status
    FROM review_comments rc JOIN cards c ON c.id = rc.card_id
    LEFT JOIN review_inbox_acknowledgements ack ON ack.project_id = c.project_id AND ack.kind = 'diff' AND ack.comment_id = rc.id
    WHERE c.project_id = ? AND c.archived_at IS NULL AND ack.comment_id IS NULL
    UNION ALL
    SELECT q.id, 'qa' AS kind, q.project_id, c.id AS source_id,
      c.title AS source_title, 'Route: ' || q.requested_url AS location,
      CASE WHEN q.status = 'failed' THEN
        'Fehler gefunden: ' || CASE WHEN json_valid(q.diagnostics_json) THEN json_array_length(q.diagnostics_json) ELSE 0 END
        || '. ' || CASE WHEN json_valid(q.diagnostics_json) THEN substr(coalesce(json_extract(q.diagnostics_json, '$[0].message'), 'Keine Diagnose gespeichert.'), 1, 240) ELSE 'Diagnose nicht lesbar.' END
      ELSE 'Prüfung nicht abgeschlossen: ' || substr(coalesce(q.note, 'Keine Details gespeichert.'), 1, 240) END AS body,
      q.ended_at AS created_at, q.status AS qa_status
    FROM card_qa_reports q JOIN cards c ON c.id = q.card_id AND c.project_id = q.project_id
    LEFT JOIN qa_inbox_acknowledgements ack ON ack.project_id = q.project_id AND ack.report_id = q.id
    WHERE q.project_id = ? AND q.status IN ('failed','error') AND c.archived_at IS NULL AND ack.report_id IS NULL
    UNION ALL
    SELECT tc.id, 'guest' AS kind, tc.project_id, c.id AS source_id,
      c.title AS source_title, 'Gastfeedback von ' || tc.display_name AS location,
      tc.body, tc.created_at, NULL AS qa_status
    FROM team_board_comments tc JOIN cards c ON c.id = tc.card_id AND c.project_id = tc.project_id
    LEFT JOIN guest_inbox_acknowledgements ack ON ack.project_id = tc.project_id AND ack.comment_id = tc.id
    WHERE tc.project_id = ? AND c.archived_at IS NULL AND ack.comment_id IS NULL
  ) WHERE (? = '' OR instr(review_search_fold(source_title), ?) > 0 OR instr(review_search_fold(location), ?) > 0 OR instr(review_search_fold(body), ?) > 0)
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(projectId, projectId, projectId, projectId, query, query, query, query, LIMIT + 1, input.offset ?? 0) as Row[];
  return { items: rows.slice(0, LIMIT).map(fromRow), hasMore: rows.length > LIMIT };
}

/** A QA acknowledgement hides one local report from the inbox, without changing the report or any workflow. */
export function acknowledgeQaInboxReport(store: StudioStore, input: AcknowledgeQaInboxReport): void {
  if (!input || typeof input.projectId !== 'string' || typeof input.reportId !== 'string' || !input.reportId) throw new Error('Ungültiger QA-Bericht.');
  store.db.transaction(() => {
    store.project(input.projectId);
    const source = store.db.prepare(`SELECT q.project_id FROM card_qa_reports q JOIN cards c ON c.id = q.card_id AND c.project_id = q.project_id
      WHERE q.id = ? AND q.status IN ('failed','error') AND c.archived_at IS NULL`).get(input.reportId) as { project_id: string } | undefined;
    if (!source || source.project_id !== input.projectId) throw new Error('QA-Bericht gehört nicht zu diesem aktiven Projekt.');
    store.db.prepare(`INSERT OR IGNORE INTO qa_inbox_acknowledgements (project_id, report_id, acknowledged_at) VALUES (?, ?, ?)`)
      .run(input.projectId, input.reportId, new Date().toISOString());
  })();
}

/** Acknowledgement only clears the inbox entry; it never approves a plan, changes a card or starts an agent. */
export function acknowledgeReviewInboxComment(store: StudioStore, input: AcknowledgeReviewInboxComment): void {
  if (!input || typeof input.projectId !== 'string' || (input.kind !== 'plan' && input.kind !== 'diff')
    || typeof input.commentId !== 'string' || !input.commentId) throw new Error('Ungültiger Review-Kommentar.');
  store.db.transaction(() => {
    store.project(input.projectId);
    const source = input.kind === 'plan'
      ? store.db.prepare(`SELECT p.project_id FROM plan_comments pc JOIN reviewed_plans p ON p.id = pc.plan_id
          WHERE pc.id = ? AND p.state = 'open'`).get(input.commentId) as { project_id: string } | undefined
      : store.db.prepare(`SELECT c.project_id FROM review_comments rc JOIN cards c ON c.id = rc.card_id
          WHERE rc.id = ? AND c.archived_at IS NULL`).get(input.commentId) as { project_id: string } | undefined;
    if (!source || source.project_id !== input.projectId) throw new Error('Review-Kommentar gehört nicht zu diesem aktiven Projekt.');
    store.db.prepare(`INSERT OR IGNORE INTO review_inbox_acknowledgements (project_id, kind, comment_id, acknowledged_at)
      VALUES (?, ?, ?, ?)`).run(input.projectId, input.kind, input.commentId, new Date().toISOString());
  })();
}

/** Hide one guest comment from the host inbox without deleting it or modifying its card. */
export function acknowledgeGuestInboxComment(store: StudioStore, input: AcknowledgeGuestInboxComment): void {
  if (!input || typeof input.projectId !== 'string' || typeof input.commentId !== 'string' || !input.commentId)
    throw new Error('Invalid guest comment.');
  store.db.transaction(() => {
    store.project(input.projectId);
    const source = store.db.prepare(`SELECT tc.project_id FROM team_board_comments tc
      JOIN cards c ON c.id = tc.card_id AND c.project_id = tc.project_id
      WHERE tc.id = ? AND c.archived_at IS NULL`).get(input.commentId) as { project_id: string } | undefined;
    if (!source || source.project_id !== input.projectId) throw new Error('Guest comment does not belong to this active project.');
    store.db.prepare('INSERT OR IGNORE INTO guest_inbox_acknowledgements (project_id, comment_id, acknowledged_at) VALUES (?, ?, ?)')
      .run(input.projectId, input.commentId, new Date().toISOString());
  })();
}
