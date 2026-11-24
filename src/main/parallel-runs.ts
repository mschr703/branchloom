import type Database from 'better-sqlite3';
import type { CardRunGate, ReserveCardSessionInput, RunDependency } from '../shared/parallel-runs';
import type { Session } from '../shared/types';
import type { StudioStore } from './store';

const DEFAULT_CAPACITY = 2;

export function installParallelRuns(db: Database.Database): void {
  const cardColumns = db.pragma('table_info(cards)') as Array<{ name: string }>;
  if (!cardColumns.some((column) => column.name === 'content_revision')) {
    db.exec('ALTER TABLE cards ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0');
  }
  const qaColumns = db.pragma('table_info(card_qa_reports)') as Array<{ name: string }>;
  if (!qaColumns.some((column) => column.name === 'content_revision')) {
    db.exec('ALTER TABLE card_qa_reports ADD COLUMN content_revision INTEGER');
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS card_content_revision_update AFTER UPDATE OF title, description, priority, labels_json, wireframe_required ON cards
    WHEN OLD.title <> NEW.title OR OLD.description <> NEW.description OR OLD.priority <> NEW.priority
      OR OLD.labels_json <> NEW.labels_json OR OLD.wireframe_required <> NEW.wireframe_required
    BEGIN UPDATE cards SET content_revision = OLD.content_revision + 1 WHERE id = NEW.id; END;
  CREATE TRIGGER IF NOT EXISTS card_criterion_revision_insert AFTER INSERT ON card_acceptance_criteria
    BEGIN UPDATE cards SET content_revision = content_revision + 1 WHERE id = NEW.card_id; END;
  CREATE TRIGGER IF NOT EXISTS card_criterion_revision_update AFTER UPDATE OF text, position ON card_acceptance_criteria
    WHEN OLD.text <> NEW.text OR OLD.position <> NEW.position
    BEGIN UPDATE cards SET content_revision = content_revision + 1 WHERE id = NEW.card_id; END;
  CREATE TRIGGER IF NOT EXISTS card_criterion_revision_delete AFTER DELETE ON card_acceptance_criteria
    BEGIN UPDATE cards SET content_revision = content_revision + 1 WHERE id = OLD.card_id; END;`);
  db.exec(`CREATE TABLE IF NOT EXISTS project_run_capacity (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    max_running INTEGER NOT NULL CHECK (max_running BETWEEN 1 AND 4)
  );
  CREATE TABLE IF NOT EXISTS card_dependency_approvals (
    child_card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    prerequisite_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    qa_report_id TEXT NOT NULL REFERENCES card_qa_reports(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    approved_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS card_run_dependencies (
    child_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    prerequisite_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (child_card_id, prerequisite_card_id),
    CHECK (child_card_id <> prerequisite_card_id)
  );
  CREATE TABLE IF NOT EXISTS card_dependency_approvals_v2 (
    child_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    prerequisite_card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    qa_report_id TEXT NOT NULL REFERENCES card_qa_reports(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    PRIMARY KEY (child_card_id, prerequisite_card_id)
  );
  CREATE TABLE IF NOT EXISTS session_card_revisions (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    content_revision INTEGER NOT NULL
  );`);
}

/** Call only after legacy running rows were marked interrupted during startup. */
export function installActiveCardIndex(db: Database.Database): void {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_running_session_per_card ON sessions(card_id) WHERE state = 'running'");
}

export function projectRunCapacity(store: StudioStore, projectId: string): number {
  store.project(projectId);
  const row = store.db.prepare('SELECT max_running FROM project_run_capacity WHERE project_id = ?').get(projectId) as { max_running: number } | undefined;
  return row?.max_running ?? DEFAULT_CAPACITY;
}

export function setProjectRunCapacity(store: StudioStore, input: { projectId: string; capacity: number }): number {
  if (!input || !Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 4) throw new Error('Kapazität muss zwischen 1 und 4 liegen.');
  store.project(input.projectId);
  store.db.prepare('INSERT INTO project_run_capacity (project_id, max_running) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET max_running = excluded.max_running').run(input.projectId, input.capacity);
  return input.capacity;
}

function verifiedWorkflowResult(store: StudioStore, prerequisiteCardId: string, contentRevision: number, latestSessionId: string | null): boolean {
  if (!latestSessionId) return false;
  return Boolean(store.db.prepare(`SELECT 1 FROM workflow_progress progress
    JOIN workflows flow ON flow.id = progress.workflow_id
    JOIN sessions session ON session.id = progress.session_id AND session.card_id = progress.card_id
    JOIN session_card_revisions revision ON revision.session_id = session.id AND revision.card_id = session.card_id
    WHERE progress.card_id = ? AND progress.session_id = ? AND progress.state = 'complete'
      AND session.state = 'exited' AND session.exit_code = 0
      AND revision.content_revision = ? AND flow.state IN ('paused', 'running', 'done')
    LIMIT 1`).get(prerequisiteCardId, latestSessionId, contentRevision));
}

function dependencies(store: StudioStore, cardId: string): RunDependency[] {
  const rows = store.db.prepare(`SELECT split.depends_on_card_id AS prerequisite_id, prerequisite.title,
      prerequisite.content_revision, prerequisite.project_id, 'split' AS source
    FROM card_splits split JOIN cards prerequisite ON prerequisite.id = split.depends_on_card_id
    WHERE split.child_card_id = ? AND split.depends_on_card_id IS NOT NULL
    UNION ALL
    SELECT relation.prerequisite_card_id AS prerequisite_id, prerequisite.title,
      prerequisite.content_revision, prerequisite.project_id, 'manual' AS source
    FROM card_run_dependencies relation JOIN cards prerequisite ON prerequisite.id = relation.prerequisite_card_id
    WHERE relation.child_card_id = ? AND NOT EXISTS (
      SELECT 1 FROM card_splits split WHERE split.child_card_id = relation.child_card_id
        AND split.depends_on_card_id = relation.prerequisite_card_id)
    ORDER BY source DESC, title, prerequisite_id`).all(cardId, cardId) as Array<{
      prerequisite_id: string; title: string; content_revision: number; project_id: string; source: 'split' | 'manual';
    }>;
  const card = store.card(cardId);
  return rows.map((row) => {
    if (row.project_id !== card.projectId) throw new Error('Vorgänger gehört nicht zum Projekt der Karte.');
    const active = store.db.prepare("SELECT 1 FROM sessions WHERE card_id = ? AND state = 'running' LIMIT 1").get(row.prerequisite_id);
    const latest = store.latestSession(row.prerequisite_id);
    const reports = store.db.prepare(`SELECT id, ended_at FROM card_qa_reports
      WHERE card_id = ? AND status = 'passed' AND content_revision = ? AND started_at > ?
      ORDER BY ended_at DESC, id DESC LIMIT 10`).all(row.prerequisite_id, row.content_revision, latest?.endedAt ?? '9999') as Array<{ id: string; ended_at: string }>;
    const eligible = latest && latest.state !== 'running' && latest.endedAt ? reports : [];
    const approval = (store.db.prepare(`SELECT approval.qa_report_id, approval.note FROM card_dependency_approvals_v2 approval
      WHERE approval.child_card_id = ? AND approval.prerequisite_card_id = ?`).get(cardId, row.prerequisite_id)
      || (row.source === 'split' ? store.db.prepare(`SELECT approval.qa_report_id, approval.note FROM card_dependency_approvals approval
      WHERE approval.child_card_id = ? AND approval.prerequisite_card_id = ?`).get(cardId, row.prerequisite_id)
      : undefined)) as { qa_report_id: string; note: string } | undefined;
    const approvedReport = approval && latest?.endedAt && store.db.prepare(`SELECT 1 FROM card_qa_reports
      WHERE id = ? AND card_id = ? AND status = 'passed' AND content_revision = ? AND started_at > ?`)
      .get(approval.qa_report_id, row.prerequisite_id, row.content_revision, latest.endedAt);
    const status: RunDependency['status'] = active ? 'blocked' : verifiedWorkflowResult(store, row.prerequisite_id, row.content_revision, latest?.id ?? null)
      ? 'workflow' : approvedReport ? 'approved' : 'blocked';
    return { prerequisiteCardId: row.prerequisite_id, prerequisiteTitle: row.title, source: row.source, status,
      approvalNote: status === 'approved' ? approval!.note : null,
      reports: eligible.map((report) => ({ id: report.id, endedAt: report.ended_at })) };
  });
}

function dependencyIds(store: StudioStore, cardId: string): string[] {
  const rows = store.db.prepare(`SELECT depends_on_card_id AS id FROM card_splits WHERE child_card_id = ? AND depends_on_card_id IS NOT NULL
    UNION SELECT prerequisite_card_id AS id FROM card_run_dependencies WHERE child_card_id = ?`).all(cardId, cardId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

export function cardRunGate(store: StudioStore, cardId: string, proposedWorktreePath?: string | null): CardRunGate {
  const card = store.card(cardId);
  const running = store.db.prepare(`SELECT session.id AS session_id, session.card_id, card.title, session.worktree_path
    FROM sessions session JOIN cards card ON card.id = session.card_id
    WHERE session.project_id = ? AND session.state = 'running' ORDER BY session.started_at, session.id`).all(card.projectId) as Array<{
    session_id: string; card_id: string; title: string; worktree_path: string | null;
  }>;
  const capacity = projectRunCapacity(store, card.projectId);
  const depends = dependencies(store, cardId);
  const blockers: string[] = [];
  if (card.archivedAt) blockers.push('Archivierte Karte zuerst wiederherstellen.');
  if (running.some((row) => row.card_id === cardId)) blockers.push('Auf dieser Karte läuft bereits ein Agent.');
  if (running.length >= capacity) blockers.push(`Projektkapazität erreicht: ${running.length} von ${capacity} Agenten laufen.`);
  if (proposedWorktreePath !== undefined && (running.some((row) => !row.worktree_path) || (running.length > 0 && !proposedWorktreePath))) blockers.push('Parallele Kartenläufe brauchen für jede laufende Karte einen eigenen Git-Worktree.');
  if (proposedWorktreePath && running.some((row) => row.worktree_path?.toLocaleLowerCase() === proposedWorktreePath.toLocaleLowerCase())) blockers.push('Ein anderer Agent benutzt denselben Worktree.');
  for (const item of depends) if (item.status === 'blocked') blockers.push(`Vorgänger „${item.prerequisiteTitle}“ braucht ein belegtes Ergebnis oder eine bewusste QA-Freigabe.`);
  return { cardId, projectId: card.projectId, capacity, runningCount: running.length,
    running: running.map((row) => ({ cardId: row.card_id, title: row.title, sessionId: row.session_id, worktreePath: row.worktree_path })),
    dependency: depends[0] ?? null, dependencies: depends, blockers, canStart: blockers.length === 0 };
}

/** Additional dependencies complement the fixed predecessor from a card split. */
export function setCardRunDependencies(store: StudioStore, input: { cardId: string; prerequisiteCardIds: string[] }): CardRunGate {
  if (!input || !Array.isArray(input.prerequisiteCardIds) || input.prerequisiteCardIds.length > 8
    || input.prerequisiteCardIds.some((id) => typeof id !== 'string' || !id)) throw new Error('Bis zu acht Vorgänger auswählen.');
  const selected = [...new Set(input.prerequisiteCardIds)];
  if (selected.length !== input.prerequisiteCardIds.length) throw new Error('Doppelte Vorgänger sind nicht erlaubt.');
  return store.db.transaction(() => {
    const card = store.card(input.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    if (store.db.prepare("SELECT 1 FROM sessions WHERE card_id = ? AND state = 'running'").get(card.id)) {
      throw new Error('Abhängigkeiten einer laufenden Karte können nicht geändert werden.');
    }
    const split = store.db.prepare('SELECT depends_on_card_id AS id FROM card_splits WHERE child_card_id = ?').get(card.id) as { id: string | null } | undefined;
    const fixedId = split?.id ?? null;
    if (selected.includes(card.id)) throw new Error('Eine Karte kann nicht von sich selbst abhängen.');
    if (selected.includes(fixedId ?? '')) throw new Error('Der Vorgänger aus der Teilkarte ist bereits fest zugeordnet.');
    if (selected.length + Number(Boolean(fixedId)) > 8) throw new Error('Eine Karte kann höchstens acht Vorgänger haben.');
    for (const id of selected) {
      const prerequisite = store.card(id);
      if (prerequisite.projectId !== card.projectId || prerequisite.archivedAt) throw new Error('Vorgänger muss eine aktive Karte desselben Projekts sein.');
    }
    const ancestors = (id: string): string[] => {
      if (id === card.id) return [...selected, ...(fixedId ? [fixedId] : [])];
      return dependencyIds(store, id);
    };
    for (const id of selected) {
      const seen = new Set<string>();
      const stack = [id];
      while (stack.length) {
        const current = stack.pop()!;
        if (current === card.id) throw new Error('Diese Abhängigkeit würde einen Zyklus erzeugen.');
        if (seen.has(current)) continue;
        seen.add(current);
        stack.push(...ancestors(current));
      }
    }
    const existing = store.db.prepare('SELECT prerequisite_card_id AS id FROM card_run_dependencies WHERE child_card_id = ? ORDER BY id').all(card.id) as Array<{ id: string }>;
    if (existing.map((row) => row.id).join('\0') === [...selected].sort().join('\0')) return cardRunGate(store, card.id);
    store.db.prepare('DELETE FROM card_run_dependencies WHERE child_card_id = ?').run(card.id);
    const insert = store.db.prepare('INSERT INTO card_run_dependencies (child_card_id, prerequisite_card_id, created_at) VALUES (?, ?, ?)');
    const stamp = new Date().toISOString();
    for (const id of selected) insert.run(card.id, id, stamp);
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1 WHERE id = ?').run(card.id);
    return cardRunGate(store, card.id);
  }).immediate();
}

export function approveCardDependency(store: StudioStore, input: { cardId: string; prerequisiteCardId?: string; qaReportId: string; note: string }): CardRunGate {
  if (!input || typeof input.note !== 'string' || input.note.trim().length < 10 || input.note.length > 1000 || /\0/.test(input.note)) {
    throw new Error('Freigabenotiz muss 10 bis 1000 Zeichen enthalten.');
  }
  if (typeof input.qaReportId !== 'string') throw new Error('QA-Bericht fehlt.');
  return store.db.transaction(() => {
    const card = store.card(input.cardId);
    if (card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
    const all = dependencies(store, card.id);
    const before = input.prerequisiteCardId ? all.find((item) => item.prerequisiteCardId === input.prerequisiteCardId) : all.length === 1 ? all[0] : null;
    if (!before) throw new Error(all.length > 1 ? 'Vorgänger für die Freigabe auswählen.' : 'Diese Karte hat keinen Vorgänger.');
    if (before.status === 'workflow') throw new Error('Der Vorgänger hat bereits ein belegtes Workflow-Ergebnis.');
    if (!before.reports.some((report) => report.id === input.qaReportId)) throw new Error('Nur ein aktueller bestandener QA-Bericht des Vorgängers kann die Freigabe belegen.');
    if (store.db.prepare("SELECT 1 FROM sessions WHERE card_id = ? AND state = 'running' LIMIT 1").get(before.prerequisiteCardId)) throw new Error('Der Vorgänger läuft noch.');
    store.db.prepare(`INSERT INTO card_dependency_approvals_v2 (child_card_id, prerequisite_card_id, qa_report_id, note, approved_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(child_card_id, prerequisite_card_id) DO UPDATE SET
      qa_report_id = excluded.qa_report_id, note = excluded.note, approved_at = excluded.approved_at`)
      .run(card.id, before.prerequisiteCardId, input.qaReportId, input.note.trim(), new Date().toISOString());
    return cardRunGate(store, card.id);
  }).immediate();
}

/** Last-line reservation for all real CLI launch paths. No PTY is spawned on rejection. */
export function reserveCardSession(store: StudioStore, input: ReserveCardSessionInput): Session {
  return store.db.transaction(() => {
    const gate = cardRunGate(store, input.cardId, input.worktreePath ?? null);
    if (!gate.canStart) throw new Error(gate.blockers[0]!);
    if (input.worktreePath) {
      const saved = store.cardWorktree(input.cardId);
      if (!saved || saved.path.toLocaleLowerCase() !== input.worktreePath.toLocaleLowerCase()) {
        throw new Error('Der Git-Worktree ist dieser Karte nicht zugeordnet.');
      }
    }
    const session = store.createSession(input);
    const revision = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(input.cardId) as { content_revision: number };
    store.db.prepare('INSERT INTO session_card_revisions (session_id, card_id, content_revision) VALUES (?, ?, ?)')
      .run(session.id, input.cardId, revision.content_revision);
    return session;
  }).immediate();
}
