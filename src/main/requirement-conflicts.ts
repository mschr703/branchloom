import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { RequirementClaim, RequirementConflict, RequirementConflictBoard, RequirementDecision, RequirementStance } from '../shared/requirement-conflicts';
import type { StudioStore } from './store';

interface ClaimRow {
  id: string; project_id: string; card_id: string; criterion_id: string; statement: string; card_revision: number;
  component: string; scope: string; property: string; stance: RequirementStance; created_at: string;
  title: string; current_revision: number; current_statement: string | null;
}
interface DecisionRow {
  id: string; pair_key: string; fingerprint: string; status: 'chosen' | 'dismissed'; winner_claim_id: string | null; winner_card_id: string | null; winner_statement: string | null;
  reason: string; left_card_id: string; right_card_id: string; left_statement: string; right_statement: string;
  left_card_revision: number; right_card_revision: number; decided_at: string;
}
const key = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function label(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${field} is required.`);
  const result = value.trim().replace(/\s+/g, ' ');
  if (!result || result.length > max || /[\0\r\n]/.test(value)) throw new Error(`${field} must be 1–${max} characters on one line.`);
  return result;
}
function cardRevision(store: StudioStore, cardId: string): number {
  return (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number }).content_revision;
}
function criterion(store: StudioStore, cardId: string, criterionId: string): { text: string } {
  const row = store.db.prepare('SELECT text FROM card_acceptance_criteria WHERE id = ? AND card_id = ?').get(criterionId, cardId) as { text: string } | undefined;
  if (!row) throw new Error('Acceptance criterion not found on this card.');
  return row;
}
function claim(row: ClaimRow): RequirementClaim {
  return { id: row.id, projectId: row.project_id, cardId: row.card_id, cardTitle: row.title, criterionId: row.criterion_id,
    statement: row.statement, cardRevision: row.card_revision, component: row.component, scope: row.scope, property: row.property,
    stance: row.stance, current: row.current_statement === row.statement && row.current_revision === row.card_revision, createdAt: row.created_at };
}
function pairKey(a: RequirementClaim, b: RequirementClaim): string { return [a.id, b.id].sort().join(':'); }
function pairFingerprint(a: RequirementClaim, b: RequirementClaim): string {
  return hash([a, b].sort((left, right) => left.id.localeCompare(right.id)).map((item) =>
    [item.id, item.cardRevision, item.statement, key(item.component), key(item.scope), key(item.property), item.stance]));
}
function decision(row: DecisionRow, currentFingerprint?: string): RequirementDecision {
  return { id: row.id, pairKey: row.pair_key, fingerprint: row.fingerprint, status: row.status, winnerClaimId: row.winner_claim_id,
    winnerCardId: row.winner_card_id, winnerStatement: row.winner_statement,
    reason: row.reason, leftCardId: row.left_card_id, rightCardId: row.right_card_id, leftStatement: row.left_statement,
    rightStatement: row.right_statement, leftCardRevision: row.left_card_revision, rightCardRevision: row.right_card_revision,
    decidedAt: row.decided_at, current: currentFingerprint === row.fingerprint };
}

export function installRequirementConflicts(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS requirement_claims (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    criterion_id TEXT NOT NULL, statement TEXT NOT NULL, card_revision INTEGER NOT NULL,
    component TEXT NOT NULL, scope TEXT NOT NULL, property TEXT NOT NULL,
    stance TEXT NOT NULL CHECK (stance IN ('required', 'forbidden')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS requirement_claims_project ON requirement_claims(project_id, active, created_at);
  CREATE TABLE IF NOT EXISTS requirement_conflict_decisions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pair_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('chosen', 'dismissed')),
    winner_claim_id TEXT, winner_card_id TEXT, winner_statement TEXT, reason TEXT NOT NULL,
    left_card_id TEXT NOT NULL, right_card_id TEXT NOT NULL,
    left_statement TEXT NOT NULL, right_statement TEXT NOT NULL,
    left_card_revision INTEGER NOT NULL, right_card_revision INTEGER NOT NULL,
    decided_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS requirement_decisions_project ON requirement_conflict_decisions(project_id, decided_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS requirement_decisions_once ON requirement_conflict_decisions(project_id, pair_key, fingerprint);`);
}

export function addRequirementClaim(store: StudioStore, input: { projectId: string; cardId: string; criterionId: string; component: string; scope: string; property: string; stance: RequirementStance; expectedCardRevision: number }): RequirementConflictBoard {
  store.db.transaction(() => {
    store.project(input.projectId);
    const card = store.card(input.cardId);
    if (card.projectId !== input.projectId || card.archivedAt) throw new Error('Card is outside this active project.');
    if (cardRevision(store, card.id) !== input.expectedCardRevision) throw new Error('Card changed. Reload its criteria before adding a rule.');
    const source = criterion(store, card.id, input.criterionId);
    if (input.stance !== 'required' && input.stance !== 'forbidden') throw new Error('Choose required or forbidden.');
    const component = label(input.component, 'Component', 80);
    const scope = label(input.scope, 'Scope', 120);
    const property = label(input.property, 'Property', 80);
    const existing = store.db.prepare('SELECT id, component, scope, property FROM requirement_claims WHERE card_id = ? AND criterion_id = ? AND active = 1').all(card.id, input.criterionId) as Array<{ id: string; component: string; scope: string; property: string }>;
    if (existing.some((row) => key(row.component) === key(component) && key(row.scope) === key(scope) && key(row.property) === key(property))) throw new Error('This criterion already has a rule for that component, scope, and property.');
    store.db.prepare(`INSERT INTO requirement_claims (id, project_id, card_id, criterion_id, statement, card_revision, component, scope, property, stance, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.projectId, card.id, input.criterionId, source.text,
      input.expectedCardRevision, component, scope, property, input.stance, new Date().toISOString());
  })();
  return requirementConflictBoard(store, input.projectId);
}

export function refreshRequirementClaim(store: StudioStore, input: { projectId: string; claimId: string; expectedCardRevision: number }): RequirementConflictBoard {
  store.db.transaction(() => {
    store.project(input.projectId);
    const row = store.db.prepare('SELECT card_id, criterion_id FROM requirement_claims WHERE id = ? AND project_id = ? AND active = 1')
      .get(input.claimId, input.projectId) as { card_id: string; criterion_id: string } | undefined;
    if (!row) throw new Error('Rule not found in this project.');
    if (cardRevision(store, row.card_id) !== input.expectedCardRevision) throw new Error('Card changed. Reload before refreshing the rule.');
    const source = criterion(store, row.card_id, row.criterion_id);
    store.db.prepare('UPDATE requirement_claims SET statement = ?, card_revision = ? WHERE id = ?').run(source.text, input.expectedCardRevision, input.claimId);
  })();
  return requirementConflictBoard(store, input.projectId);
}

export function removeRequirementClaim(store: StudioStore, input: { projectId: string; claimId: string }): RequirementConflictBoard {
  store.project(input.projectId);
  const result = store.db.prepare('UPDATE requirement_claims SET active = 0 WHERE id = ? AND project_id = ? AND active = 1').run(input.claimId, input.projectId);
  if (result.changes !== 1) throw new Error('Rule not found in this project.');
  return requirementConflictBoard(store, input.projectId);
}

export function requirementConflictBoard(store: StudioStore, projectId: string): RequirementConflictBoard {
  store.project(projectId);
  const rows = store.db.prepare(`SELECT r.*, c.title, c.content_revision AS current_revision, a.text AS current_statement
    FROM requirement_claims r JOIN cards c ON c.id = r.card_id
    LEFT JOIN card_acceptance_criteria a ON a.id = r.criterion_id AND a.card_id = r.card_id
    WHERE r.project_id = ? AND r.active = 1 ORDER BY r.created_at, r.id LIMIT 201`).all(projectId) as ClaimRow[];
  const limited = rows.length > 200;
  const claims = rows.slice(0, 200).map(claim);
  const groups = new Map<string, { required: RequirementClaim[]; forbidden: RequirementClaim[] }>();
  for (const item of claims) {
    const id = JSON.stringify([key(item.component), key(item.scope), key(item.property)]);
    const group = groups.get(id) ?? { required: [], forbidden: [] };
    group[item.stance].push(item); groups.set(id, group);
  }
  const conflicts: RequirementConflict[] = [];
  pairSearch: for (const group of groups.values()) for (const required of group.required) for (const forbidden of group.forbidden) {
    if (required.cardId === forbidden.cardId) continue;
    const [left, right] = [required, forbidden].sort((a, b) => a.cardId.localeCompare(b.cardId) || a.id.localeCompare(b.id));
    conflicts.push({ pairKey: pairKey(left!, right!), fingerprint: pairFingerprint(left!, right!), component: left!.component,
      scope: left!.scope, property: left!.property, left: left!, right: right!, current: left!.current && right!.current, decision: null });
    if (conflicts.length >= 100) break pairSearch;
  }
  const saved = store.db.prepare('SELECT * FROM requirement_conflict_decisions WHERE project_id = ? ORDER BY decided_at DESC, id DESC LIMIT 501').all(projectId) as DecisionRow[];
  const byFingerprint = new Map(conflicts.map((item) => [`${item.pairKey}:${item.fingerprint}`, item]));
  const decisionHistory = saved.slice(0, 500).map((row) => {
    const match = byFingerprint.get(`${row.pair_key}:${row.fingerprint}`);
    return decision(row, match?.current ? match.fingerprint : undefined);
  });
  const newest = new Map(decisionHistory.map((item) => [`${item.pairKey}:${item.fingerprint}`, item]));
  for (const item of conflicts) item.decision = newest.get(`${item.pairKey}:${item.fingerprint}`) ?? null;
  const cardRevisions = Object.fromEntries((store.db.prepare('SELECT id, content_revision FROM cards WHERE project_id = ? AND archived_at IS NULL').all(projectId) as Array<{ id: string; content_revision: number }>).map((row) => [row.id, row.content_revision]));
  return { claims, conflicts, decisionHistory, cardRevisions, limited: limited || saved.length > 500 || conflicts.length >= 100 };
}

export function resolveRequirementConflict(store: StudioStore, input: { projectId: string; pairKey: string; fingerprint: string; status: 'chosen' | 'dismissed'; winnerClaimId?: string | null; reason: string }): RequirementConflictBoard {
  store.db.transaction(() => {
    const board = requirementConflictBoard(store, input.projectId);
    const item = board.conflicts.find((entry) => entry.pairKey === input.pairKey);
    if (!item || item.fingerprint !== input.fingerprint || !item.current) throw new Error('Conflict sources changed. Reload and review both statements.');
    if (item.decision) throw new Error('This exact conflict was already decided.');
    if (input.status !== 'chosen' && input.status !== 'dismissed') throw new Error('Choose a decision type.');
    const winner = input.status === 'chosen' ? input.winnerClaimId : null;
    if (input.status === 'chosen' && winner !== item.left.id && winner !== item.right.id) throw new Error('Choose one of the two source rules.');
    const reason = label(input.reason, 'Reason', 500);
    const winningClaim = winner === item.left.id ? item.left : winner === item.right.id ? item.right : null;
    store.db.prepare(`INSERT INTO requirement_conflict_decisions (id, project_id, pair_key, fingerprint, status, winner_claim_id, winner_card_id, winner_statement, reason,
      left_card_id, right_card_id, left_statement, right_statement, left_card_revision, right_card_revision, decided_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.projectId, item.pairKey, item.fingerprint,
      input.status, winner, winningClaim?.cardId ?? null, winningClaim?.statement ?? null, reason, item.left.cardId, item.right.cardId, item.left.statement, item.right.statement,
      item.left.cardRevision, item.right.cardRevision, new Date().toISOString());
  })();
  return requirementConflictBoard(store, input.projectId);
}
