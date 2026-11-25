import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CreateDevAccount, DevAccount, DevAccountAssignment, DevAccountOverview } from '../shared/dev-account';
import type { StudioStore } from './store';

interface AccountRow {
  id: string; project_id: string; service: string; environment: string; role: string;
  subject: string; probe_path: string; created_at: string;
}
interface AssignmentRow { card_id: string; account_id: string; assigned_at: string }

const account = (row: AccountRow): DevAccount => ({ id: row.id, projectId: row.project_id, service: row.service,
  environment: row.environment, role: row.role, subject: row.subject, probePath: row.probe_path, createdAt: row.created_at });
const assignment = (row: AssignmentRow): DevAccountAssignment => ({ cardId: row.card_id, accountId: row.account_id, assignedAt: row.assigned_at });

export function installDevAccounts(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS dev_accounts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    service TEXT NOT NULL, environment TEXT NOT NULL, role TEXT NOT NULL,
    subject TEXT NOT NULL, probe_path TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS dev_accounts_project ON dev_accounts(project_id, created_at);
  CREATE TABLE IF NOT EXISTS card_dev_account_assignments (
    card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    assigned_at TEXT NOT NULL
  );`);
}

function label(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const result = value.trim();
  if (!result || result.length > 120 || /[\0\r\n]/u.test(result)) throw new Error(`${field} must be 1–120 characters on one line.`);
  return result;
}

function checkedPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9_/-]{1,120}$/u.test(value) || value.includes('//') || value.includes('..')) {
    throw new Error('Identity endpoint must be a local path such as /api/me, without query or fragment.');
  }
  return value;
}

export function createDevAccount(store: StudioStore, input: CreateDevAccount): DevAccount {
  if (!input || typeof input.projectId !== 'string') throw new Error('Choose a project.');
  store.project(input.projectId);
  const data = { service: label(input.service, 'Service'), environment: label(input.environment, 'Environment'),
    role: label(input.role, 'Role'), subject: label(input.subject, 'Account subject'), probePath: checkedPath(input.probePath) };
  const id = randomUUID(); const createdAt = new Date().toISOString();
  store.db.prepare(`INSERT INTO dev_accounts (id, project_id, service, environment, role, subject, probe_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.projectId, data.service, data.environment, data.role, data.subject, data.probePath, createdAt);
  return { id, projectId: input.projectId, ...data, createdAt };
}

export function devAccountOverview(store: StudioStore, input: { projectId: string; cardId: string }): DevAccountOverview {
  const card = store.card(input.cardId);
  if (card.projectId !== input.projectId) throw new Error('Card belongs to another project.');
  const accounts = (store.db.prepare('SELECT * FROM dev_accounts WHERE project_id = ? ORDER BY created_at, id').all(input.projectId) as AccountRow[]).map(account);
  const linked = store.db.prepare(`SELECT a.* FROM card_dev_account_assignments a JOIN dev_accounts d ON d.id = a.account_id
    WHERE a.card_id = ? AND d.project_id = ?`).get(card.id, input.projectId) as AssignmentRow | undefined;
  const revision = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number };
  return { accounts, assignment: linked ? assignment(linked) : null, cardRevision: revision.content_revision };
}

/** A card grant is a deliberate revision. It never includes a login secret or browser cookie. */
export function assignDevAccount(store: StudioStore, input: { projectId: string; cardId: string; accountId: string | null; expectedCardRevision: number }): DevAccountOverview {
  store.db.transaction(() => {
    const card = store.card(input.cardId);
    if (card.projectId !== input.projectId || card.archivedAt) throw new Error('Card is unavailable in this project.');
    const latest = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number };
    if (!Number.isInteger(input.expectedCardRevision) || input.expectedCardRevision !== latest.content_revision) throw new Error('Card changed. Reload its account assignment.');
    if (input.accountId !== null) {
      const found = store.db.prepare('SELECT * FROM dev_accounts WHERE id = ? AND project_id = ?').get(input.accountId, input.projectId) as AccountRow | undefined;
      if (!found) throw new Error('Account does not belong to this project.');
      store.db.prepare(`INSERT INTO card_dev_account_assignments (card_id, account_id, assigned_at) VALUES (?, ?, ?)
        ON CONFLICT(card_id) DO UPDATE SET account_id = excluded.account_id, assigned_at = excluded.assigned_at`)
        .run(card.id, found.id, new Date().toISOString());
    } else store.db.prepare('DELETE FROM card_dev_account_assignments WHERE card_id = ?').run(card.id);
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), card.id);
  }).immediate();
  return devAccountOverview(store, input);
}

export function cardDevAccountGrant(store: StudioStore, cardId: string): DevAccount {
  const card = store.card(cardId);
  if (card.archivedAt) throw new Error('Restore the card before using its account.');
  const found = store.db.prepare(`SELECT d.* FROM card_dev_account_assignments a JOIN dev_accounts d ON d.id = a.account_id
    WHERE a.card_id = ? AND d.project_id = ?`).get(card.id, card.projectId) as AccountRow | undefined;
  if (!found) throw new Error('No development account is assigned to this card.');
  return account(found);
}

export function devAccountForProject(store: StudioStore, projectId: string, accountId: string): DevAccount {
  store.project(projectId);
  const found = store.db.prepare('SELECT * FROM dev_accounts WHERE id = ? AND project_id = ?').get(accountId, projectId) as AccountRow | undefined;
  if (!found) throw new Error('Account does not belong to this project.');
  return account(found);
}
