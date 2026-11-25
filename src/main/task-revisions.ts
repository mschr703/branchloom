import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ConfirmTaskRevisionInput, TaskRevision, TaskRevisionHistory, TaskRevisionDelivery } from '../shared/task-revisions';
import { assertSafeModelContext } from './sensitive-content';
import type { SessionRunner } from './cli';
import type { StudioStore } from './store';

interface RevisionRow {
  id: string; project_id: string; card_id: string; revision_number: number;
  base_content_revision: number; committed_content_revision: number;
  from_title: string; from_description: string; to_title: string; to_description: string;
  reason: string; created_at: string; delivery: TaskRevisionDelivery;
  source_session_id: string | null;
  target_session_id: string | null; delivered_at: string | null;
}

const revision = (row: RevisionRow): TaskRevision => ({
  id: row.id, projectId: row.project_id, cardId: row.card_id, number: row.revision_number,
  baseContentRevision: row.base_content_revision, committedContentRevision: row.committed_content_revision,
  fromTitle: row.from_title, fromDescription: row.from_description, toTitle: row.to_title,
  toDescription: row.to_description, reason: row.reason, createdAt: row.created_at,
  sourceSessionId: row.source_session_id,
  delivery: row.delivery, targetSessionId: row.target_session_id, deliveredAt: row.delivered_at,
});

function contentRevision(store: StudioStore, cardId: string): number {
  const row = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number } | undefined;
  if (!row) throw new Error('Card not found');
  return row.content_revision;
}

export function installTaskRevisions(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS task_revisions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL, base_content_revision INTEGER NOT NULL,
    committed_content_revision INTEGER NOT NULL, from_title TEXT NOT NULL, from_description TEXT NOT NULL,
    to_title TEXT NOT NULL, to_description TEXT NOT NULL, reason TEXT NOT NULL,
    source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL, delivery TEXT NOT NULL CHECK (delivery IN ('prepared', 'submitting', 'submitted', 'included', 'uncertain')),
    target_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL, delivered_at TEXT,
    UNIQUE(card_id, revision_number)
  );
  CREATE INDEX IF NOT EXISTS idx_task_revisions_card ON task_revisions(card_id, revision_number DESC);`);
  // A crash between reserving and writing to a PTY has an unknown outcome. Never replay it.
  db.prepare("UPDATE task_revisions SET delivery = 'uncertain' WHERE delivery = 'submitting'").run();
}

export function taskRevisionHistory(store: StudioStore, input: { projectId: string; cardId: string }): TaskRevisionHistory {
  const card = store.card(input.cardId);
  if (card.projectId !== input.projectId) throw new Error('Card belongs to another project');
  const rows = store.db.prepare('SELECT * FROM task_revisions WHERE card_id = ? ORDER BY revision_number DESC, id DESC LIMIT 50').all(card.id) as RevisionRow[];
  const total = (store.db.prepare('SELECT COUNT(*) AS total FROM task_revisions WHERE card_id = ?').get(card.id) as { total: number }).total;
  return { contentRevision: contentRevision(store, card.id), total, revisions: rows.map(revision) };
}

export function confirmTaskRevision(store: StudioStore, input: ConfirmTaskRevisionInput): TaskRevisionHistory {
  if (!input || typeof input.projectId !== 'string' || typeof input.cardId !== 'string'
    || !Number.isSafeInteger(input.expectedContentRevision) || input.expectedContentRevision < 0) throw new Error('Invalid task revision request');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = input.description;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!title || title.length > 160 || /\0/.test(title)) throw new Error('Title must be 1–160 characters');
  if (typeof description !== 'string' || description.length > 6000 || /\0/.test(description)) throw new Error('Description exceeds 6000 characters');
  if (!reason || reason.length > 1000 || /\0/.test(reason)) throw new Error('Change reason must be 1–1000 characters');
  store.db.transaction(() => {
    const old = store.card(input.cardId);
    if (old.projectId !== input.projectId) throw new Error('Card belongs to another project');
    if (old.archivedAt) throw new Error('Restore the archived card first');
    const base = contentRevision(store, old.id);
    if (base !== input.expectedContentRevision) throw new Error('Card changed since the revision draft. Reload the current scope.');
    if (old.title === title && old.description === description) throw new Error('The revised scope must change the title or description');
    const next = (store.db.prepare('SELECT COALESCE(MAX(revision_number), 0) + 1 AS number FROM task_revisions WHERE card_id = ?')
      .get(old.id) as { number: number }).number;
    const sourceSessionId = store.latestSession(old.id)?.state === 'running' ? store.latestSession(old.id)!.id : null;
    store.updateCard({ id: old.id, title, description });
    // Keep the current PTY alive, but do not let its old scope advance the route.
    if (sourceSessionId) {
      const linked = store.workflowForSession(sourceSessionId);
      if (linked) {
        if (store.workflow(linked.id).state === 'running') store.setWorkflowState(linked.id, 'paused');
        const queue = store.projectQueue(old.projectId);
        if (queue.state === 'running' && queue.activeWorkflowId === linked.id) {
          store.saveProjectQueue({ projectId: old.projectId, state: 'paused', templateWorkflowId: queue.templateWorkflowId,
            activeWorkflowId: queue.activeWorkflowId, pauseReason: 'Auftragsrevision bestätigt: laufenden Kartenstand und Ergebnis vor Fortsetzung prüfen.' });
        }
      }
    }
    store.db.prepare(`INSERT INTO task_revisions
      (id, project_id, card_id, revision_number, base_content_revision, committed_content_revision,
       from_title, from_description, to_title, to_description, reason, source_session_id, created_at, delivery)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared')`)
      .run(randomUUID(), old.projectId, old.id, next, base, contentRevision(store, old.id),
        old.title, old.description, title, description, reason, sourceSessionId, new Date().toISOString());
  })();
  return taskRevisionHistory(store, input);
}

function latestCurrent(store: StudioStore, cardId: string): TaskRevision | null {
  const row = store.db.prepare('SELECT * FROM task_revisions WHERE card_id = ? ORDER BY revision_number DESC LIMIT 1').get(cardId) as RevisionRow | undefined;
  return row && row.committed_content_revision === contentRevision(store, cardId) ? revision(row) : null;
}

export function currentTaskRevisionContext(store: StudioStore, cardId: string): { id: string; text: string } | null {
  const latest = latestCurrent(store, cardId);
  if (!latest) return null;
  const text = `Confirmed task revision ${latest.number} for this card supersedes its previous scope.\n`
    + `Current title: ${latest.toTitle}\nCurrent description: ${latest.toDescription || '[none]'}\n`
    + `Reason for change: ${latest.reason}\nReview existing work before removing anything; the revision does not prove any code was changed.`;
  assertSafeModelContext([{ field: 'Task revision', text }]);
  return { id: latest.id, text };
}

export function recordTaskRevisionInLaunch(store: StudioStore, input: { revisionId: string; cardId: string; sessionId: string }): void {
  store.db.transaction(() => {
    const current = latestCurrent(store, input.cardId);
    if (!current || current.id !== input.revisionId || current.delivery !== 'prepared') return;
    const session = store.session(input.sessionId);
    if (session.cardId !== input.cardId || session.state !== 'running') return;
    store.db.prepare("UPDATE task_revisions SET delivery = 'included', target_session_id = ?, delivered_at = ? WHERE id = ? AND delivery = 'prepared'")
      .run(session.id, new Date().toISOString(), current.id);
  })();
}

export function wasTaskRevisedDuringSession(store: StudioStore, sessionId: string): boolean {
  return Boolean(store.db.prepare('SELECT 1 FROM task_revisions WHERE source_session_id = ? LIMIT 1').get(sessionId));
}

export function submitTaskRevision(store: StudioStore, runner: SessionRunner, input: { projectId: string; cardId: string; revisionId: string; sessionId: string }): TaskRevisionHistory {
  if (!input || typeof input.projectId !== 'string' || typeof input.cardId !== 'string'
    || typeof input.revisionId !== 'string' || typeof input.sessionId !== 'string') throw new Error('Invalid task revision delivery');
  const selected = store.db.transaction(() => {
    if (store.card(input.cardId).archivedAt) throw new Error('Restore the archived card before submitting a revision.');
    const current = latestCurrent(store, input.cardId);
    if (!current || current.id !== input.revisionId || current.projectId !== input.projectId || current.delivery !== 'prepared') throw new Error('Revision is stale or already submitted. Reload the card.');
    const session = store.sessionForProject(input.projectId, input.sessionId);
    if (current.sourceSessionId !== session.id || session.cardId !== input.cardId || session.state !== 'running' || store.latestSession(input.cardId)?.id !== session.id
      || !runner.hasLiveProcess(session.id)) throw new Error('The selected agent session is no longer running on this card.');
    const text = `Task revision ${current.number}, confirmed by the user. The new scope supersedes the earlier one.\n`
      + `Current title: ${current.toTitle}\nCurrent description: ${current.toDescription || '[none]'}\n`
      + `Reason: ${current.reason}\nCheck existing work before removing it. Please explain what still applies and what needs another check.`;
    assertSafeModelContext([{ field: 'Task revision', text }]);
    store.db.prepare("UPDATE task_revisions SET delivery = 'submitting', target_session_id = ? WHERE id = ? AND delivery = 'prepared'")
      .run(session.id, current.id);
    return { id: current.id, text, sessionId: session.id };
  })();
  try {
    runner.send({ sessionId: selected.sessionId, text: selected.text });
    store.db.prepare("UPDATE task_revisions SET delivery = 'submitted', delivered_at = ? WHERE id = ? AND delivery = 'submitting'")
      .run(new Date().toISOString(), selected.id);
  } catch (error) {
    store.db.prepare("UPDATE task_revisions SET delivery = 'uncertain' WHERE id = ? AND delivery = 'submitting'").run(selected.id);
    throw error;
  }
  return taskRevisionHistory(store, input);
}
