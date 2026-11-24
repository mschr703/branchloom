import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CardCriterion, CardCriterionEvidence, CardCriterionEvidenceKind } from '../shared/card-acceptance';
import type { StudioStore } from './store';

const MAX_CRITERIA = 30;
const MAX_LINKS = 10;
type CriterionRow = { id: string; card_id: string; text: string; position: number; created_at: string; updated_at: string };
type EvidenceRow = { id: string; criterion_id: string; kind: CardCriterionEvidenceKind; source_id: string; criterion_text: string; note: string; linked_at: string };

export function installCardAcceptance(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS card_acceptance_criteria (
    id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS card_acceptance_criteria_card ON card_acceptance_criteria(card_id, position);
  CREATE TABLE IF NOT EXISTS card_acceptance_evidence (
    id TEXT PRIMARY KEY, criterion_id TEXT NOT NULL REFERENCES card_acceptance_criteria(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('qa', 'review')), source_id TEXT NOT NULL, criterion_text TEXT NOT NULL,
    note TEXT NOT NULL, linked_at TEXT NOT NULL, UNIQUE(criterion_id, kind, source_id)
  );
  CREATE INDEX IF NOT EXISTS card_acceptance_evidence_criterion ON card_acceptance_evidence(criterion_id, linked_at);`);
  const columns = db.pragma('table_info(card_acceptance_evidence)') as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'criterion_text')) db.exec("ALTER TABLE card_acceptance_evidence ADD COLUMN criterion_text TEXT NOT NULL DEFAULT ''");
}

function checkedCard(store: StudioStore, cardId: string, write = false): void {
  const card = store.card(cardId);
  if (write && card.archivedAt) throw new Error('Archivierte Karte zuerst wiederherstellen.');
}

function checkedCriterion(store: StudioStore, cardId: string, criterionId: string): CriterionRow {
  const row = store.db.prepare('SELECT * FROM card_acceptance_criteria WHERE id = ? AND card_id = ?').get(criterionId, cardId) as CriterionRow | undefined;
  if (!row) throw new Error('Abnahmekriterium nicht auf dieser Karte gefunden.');
  return row;
}

function checkedText(value: string, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label} fehlt.`);
  const text = value.trim();
  if (!text || text.length > max || /\0/.test(text)) throw new Error(`${label} muss 1 bis ${max} Zeichen enthalten.`);
  return text;
}

function source(store: StudioStore, cardId: string, kind: CardCriterionEvidenceKind, sourceId: string): Pick<CardCriterionEvidence, 'sourceAvailable' | 'sourceLabel' | 'sourceStatus'> {
  if (kind === 'qa') {
    const row = store.db.prepare('SELECT status, ended_at, viewport_width, viewport_height FROM card_qa_reports WHERE id = ? AND card_id = ?')
      .get(sourceId, cardId) as { status: 'passed' | 'failed' | 'error'; ended_at: string; viewport_width: number; viewport_height: number } | undefined;
    return row ? { sourceAvailable: true, sourceLabel: `Browser-QA ${new Date(row.ended_at).toLocaleString('de-DE')} · ${row.viewport_width} × ${row.viewport_height}`, sourceStatus: row.status }
      : { sourceAvailable: false, sourceLabel: 'QA-Bericht nicht mehr gespeichert', sourceStatus: 'missing' };
  }
  if (kind === 'review') {
    const row = store.db.prepare('SELECT file_path, side, line FROM review_comments WHERE id = ? AND card_id = ?')
      .get(sourceId, cardId) as { file_path: string; side: string; line: number } | undefined;
    return row ? { sourceAvailable: true, sourceLabel: `Diff-Kommentar · ${row.file_path}:${row.line} (${row.side === 'new' ? 'neu' : 'alt'})`, sourceStatus: 'review' }
      : { sourceAvailable: false, sourceLabel: 'Review-Kommentar nicht mehr gespeichert', sourceStatus: 'missing' };
  }
  throw new Error('Unbekannte Belegart.');
}

export function cardCriteria(store: StudioStore, cardId: string): CardCriterion[] {
  checkedCard(store, cardId);
  const rows = store.db.prepare('SELECT * FROM card_acceptance_criteria WHERE card_id = ? ORDER BY position, created_at, id').all(cardId) as CriterionRow[];
  const evidenceQuery = store.db.prepare('SELECT * FROM card_acceptance_evidence WHERE criterion_id = ? ORDER BY linked_at, rowid');
  return rows.map((row) => ({
    id: row.id, cardId: row.card_id, text: row.text, position: row.position, createdAt: row.created_at, updatedAt: row.updated_at,
    evidence: (evidenceQuery.all(row.id) as EvidenceRow[]).map((link) => ({
      id: link.id, kind: link.kind, sourceId: link.source_id, note: link.note, linkedAt: link.linked_at,
      currentForCriterion: link.criterion_text === row.text,
      ...source(store, cardId, link.kind, link.source_id),
    })),
  }));
}

export function createCardCriterion(store: StudioStore, input: { cardId: string; text: string }): CardCriterion[] {
  checkedCard(store, input.cardId, true);
  const text = checkedText(input.text, 'Abnahmekriterium', 500);
  const count = store.db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM card_acceptance_criteria WHERE card_id = ?').get(input.cardId) as { n: number; last: number };
  if (count.n >= MAX_CRITERIA) throw new Error(`Höchstens ${MAX_CRITERIA} Abnahmekriterien pro Karte.`);
  const now = new Date().toISOString();
  store.db.prepare('INSERT INTO card_acceptance_criteria VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), input.cardId, text, count.last + 1, now, now);
  return cardCriteria(store, input.cardId);
}

export function updateCardCriterion(store: StudioStore, input: { cardId: string; criterionId: string; text: string }): CardCriterion[] {
  checkedCard(store, input.cardId, true);
  checkedCriterion(store, input.cardId, input.criterionId);
  const text = checkedText(input.text, 'Abnahmekriterium', 500);
  store.db.prepare('UPDATE card_acceptance_criteria SET text = ?, updated_at = ? WHERE id = ?').run(text, new Date().toISOString(), input.criterionId);
  return cardCriteria(store, input.cardId);
}

export function deleteCardCriterion(store: StudioStore, input: { cardId: string; criterionId: string }): CardCriterion[] {
  checkedCard(store, input.cardId, true);
  checkedCriterion(store, input.cardId, input.criterionId);
  store.db.prepare('DELETE FROM card_acceptance_criteria WHERE id = ?').run(input.criterionId);
  return cardCriteria(store, input.cardId);
}

export function linkCardCriterionEvidence(store: StudioStore, input: { cardId: string; criterionId: string; kind: CardCriterionEvidenceKind; sourceId: string; note: string }): CardCriterion[] {
  checkedCard(store, input.cardId, true);
  const criterion = checkedCriterion(store, input.cardId, input.criterionId);
  const note = checkedText(input.note, 'Einordnung des Belegs', 500);
  if (typeof input.sourceId !== 'string' || !input.sourceId || !['qa', 'review'].includes(input.kind)) throw new Error('Ungültiger Prüfbeleg.');
  if (!source(store, input.cardId, input.kind, input.sourceId).sourceAvailable) throw new Error('Prüfbeleg gehört nicht zu dieser Karte oder ist nicht mehr gespeichert.');
  const count = store.db.prepare('SELECT COUNT(*) AS n FROM card_acceptance_evidence WHERE criterion_id = ?').get(input.criterionId) as { n: number };
  if (count.n >= MAX_LINKS) throw new Error(`Höchstens ${MAX_LINKS} Verweise pro Abnahmekriterium.`);
  const prior = store.db.prepare('SELECT 1 FROM card_acceptance_evidence WHERE criterion_id = ? AND kind = ? AND source_id = ?').get(input.criterionId, input.kind, input.sourceId);
  if (prior) throw new Error('Dieser Prüfbeleg ist bereits verknüpft.');
  store.db.prepare('INSERT INTO card_acceptance_evidence VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), input.criterionId, input.kind, input.sourceId, criterion.text, note, new Date().toISOString());
  return cardCriteria(store, input.cardId);
}

export function unlinkCardCriterionEvidence(store: StudioStore, input: { cardId: string; criterionId: string; evidenceId: string }): CardCriterion[] {
  checkedCard(store, input.cardId, true);
  checkedCriterion(store, input.cardId, input.criterionId);
  const result = store.db.prepare('DELETE FROM card_acceptance_evidence WHERE id = ? AND criterion_id = ?').run(input.evidenceId, input.criterionId);
  if (!result.changes) throw new Error('Verweis nicht auf diesem Abnahmekriterium gefunden.');
  return cardCriteria(store, input.cardId);
}
