import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CreateDevAccount, DevAccount, DevAccountAssignment, DevAccountOverview, DevAccountSeedConfig, DevAccountSeedAttempt } from '../shared/dev-account';
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
  );
  CREATE TABLE IF NOT EXISTS dev_account_seed_configs (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    service TEXT NOT NULL, environment TEXT NOT NULL, path TEXT NOT NULL, revision TEXT NOT NULL,
    PRIMARY KEY(project_id, service, environment)
  );
  CREATE TABLE IF NOT EXISTS dev_account_seed_attempts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    provisioner_id TEXT NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
    state TEXT NOT NULL, at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dev_account_saved_logins (
    account_id TEXT PRIMARY KEY REFERENCES dev_accounts(id) ON DELETE CASCADE,
    sealed BLOB NOT NULL, saved_at TEXT NOT NULL
  );`);
  // A crashed POST has an unknown outcome. Never silently repeat it after restart.
  db.prepare("UPDATE dev_account_seed_attempts SET state = 'unknown' WHERE state = 'requested'").run();
}

function label(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be text.`);
  const result = value.trim();
  if (!result || result.length > 120 || /[\0\r\n]/u.test(result)) throw new Error(`${field} must be 1–120 characters on one line.`);
  return result;
}

export function checkedPath(value: unknown): string {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9_/-]{1,120}$/u.test(value) || value.includes('//') || value.includes('..')) {
    throw new Error('Identity endpoint must be a local path such as /api/me, without query or fragment.');
  }
  return value;
}

export function seedConfig(store: StudioStore, projectId: string, service: string, environment: string): DevAccountSeedConfig | null {
  store.project(projectId);
  const row = store.db.prepare('SELECT * FROM dev_account_seed_configs WHERE project_id = ? AND service = ? AND environment = ?')
    .get(projectId, service, environment) as { project_id: string; service: string; environment: string; path: string; revision: string } | undefined;
  return row ? { projectId: row.project_id, service: row.service, environment: row.environment, path: row.path, revision: row.revision } : null;
}

export function saveSeedConfig(store: StudioStore, input: { projectId: string; service: string; environment: string; path: string }): DevAccountSeedConfig {
  store.project(input.projectId);
  const service = label(input.service, 'Service');
  const environment = label(input.environment, 'Environment');
  const path = checkedPath(input.path);
  const revision = randomUUID();
  store.db.prepare(`INSERT INTO dev_account_seed_configs (project_id, service, environment, path, revision) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, service, environment) DO UPDATE SET path = excluded.path, revision = excluded.revision`)
    .run(input.projectId, service, environment, path, revision);
  return { projectId: input.projectId, service, environment, path, revision };
}

export function lastSeedAttempt(store: StudioStore, projectId: string, targetId: string): DevAccountSeedAttempt | null {
  devAccountForProject(store, projectId, targetId);
  const row = store.db.prepare('SELECT * FROM dev_account_seed_attempts WHERE project_id = ? AND target_id = ? ORDER BY at DESC, rowid DESC LIMIT 1')
    .get(projectId, targetId) as { id: string; project_id: string; card_id: string; provisioner_id: string; target_id: string; state: DevAccountSeedAttempt['state']; at: string } | undefined;
  return row ? { id: row.id, projectId: row.project_id, cardId: row.card_id, provisionerId: row.provisioner_id, targetId: row.target_id, state: row.state, at: row.at } : null;
}

export function recordSeedAttempt(store: StudioStore, input: Omit<DevAccountSeedAttempt, 'at'>): DevAccountSeedAttempt {
  const at = new Date().toISOString();
  store.db.prepare('INSERT INTO dev_account_seed_attempts (id, project_id, card_id, provisioner_id, target_id, state, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(input.id, input.projectId, input.cardId, input.provisionerId, input.targetId, input.state, at);
  return { ...input, at };
}

export function finishSeedAttempt(store: StudioStore, id: string, state: DevAccountSeedAttempt['state']): void {
  store.db.prepare("UPDATE dev_account_seed_attempts SET state = ? WHERE id = ? AND state = 'requested'").run(state, id);
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

export function savedDevLogin(store: StudioStore, accountId: string): { sealed: Buffer; savedAt: string } | null {
  const row = store.db.prepare('SELECT sealed, saved_at FROM dev_account_saved_logins WHERE account_id = ?')
    .get(accountId) as { sealed: Buffer; saved_at: string } | undefined;
  return row ? { sealed: row.sealed, savedAt: row.saved_at } : null;
}

export function saveDevLogin(store: StudioStore, accountId: string, sealed: Buffer): string {
  const savedAt = new Date().toISOString();
  store.db.prepare(`INSERT INTO dev_account_saved_logins (account_id, sealed, saved_at) VALUES (?, ?, ?)
    ON CONFLICT(account_id) DO UPDATE SET sealed = excluded.sealed, saved_at = excluded.saved_at`)
    .run(accountId, sealed, savedAt);
  return savedAt;
}

export function forgetDevLogin(store: StudioStore, accountId: string): void {
  store.db.prepare('DELETE FROM dev_account_saved_logins WHERE account_id = ?').run(accountId);
}
