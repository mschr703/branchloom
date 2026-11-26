import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CardPriority } from '../shared/types';
import type { CreatedTeamBoardInvite, TeamBoardInvite, TeamBoardSnapshot } from '../shared/team-board';
import type { StudioStore } from './store';
import { redactSensitiveText } from './sensitive-content';

const MAX_CARDS = 200;
const MAX_ACTIVE_INVITES = 10;
const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;
type InviteRow = { id: string; project_id: string; display_name: string; role: 'viewer'; secret_hash: string;
  created_at: string; expires_at: string; revoked_at: string | null };

export function installTeamBoard(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS team_board_invites (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role = 'viewer'), secret_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
  ); CREATE INDEX IF NOT EXISTS idx_team_board_invites_project ON team_board_invites(project_id, created_at DESC);`);
  // A listener's random port and in-memory allowlist do not survive an app restart.
  db.prepare('UPDATE team_board_invites SET revoked_at = ? WHERE revoked_at IS NULL').run(new Date().toISOString());
}

const asInvite = (row: InviteRow): TeamBoardInvite => ({ id: row.id, projectId: row.project_id,
  displayName: row.display_name, role: row.role, createdAt: row.created_at,
  expiresAt: row.expires_at, revokedAt: row.revoked_at });

export function teamBoardInvites(store: StudioStore, projectId: string): TeamBoardInvite[] {
  store.project(projectId);
  return (store.db.prepare('SELECT * FROM team_board_invites WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30')
    .all(projectId) as InviteRow[]).map(asInvite);
}

export function createTeamBoardInvite(store: StudioStore, input: { projectId: string; displayName: string }): CreatedTeamBoardInvite {
  if (!input || typeof input.projectId !== 'string' || typeof input.displayName !== 'string') throw new Error('Project and guest name are required.');
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80 || /[\x00-\x1f\x7f]/.test(displayName)) throw new Error('Guest name must be 1–80 printable characters.');
  const secret = randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS).toISOString();
  const row: InviteRow = { id: randomUUID(), project_id: input.projectId, display_name: displayName,
    role: 'viewer', secret_hash: createHash('sha256').update(secret).digest('hex'),
    created_at: createdAt, expires_at: expiresAt, revoked_at: null };
  store.db.transaction(() => {
    store.project(input.projectId);
    const active = store.db.prepare('SELECT COUNT(*) AS count FROM team_board_invites WHERE project_id = ? AND revoked_at IS NULL AND expires_at > ?')
      .get(input.projectId, createdAt) as { count: number };
    if (active.count >= MAX_ACTIVE_INVITES) throw new Error('Revoke an invitation before creating another one.');
    store.db.prepare('INSERT INTO team_board_invites VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.project_id, row.display_name, row.role, row.secret_hash, row.created_at, row.expires_at, row.revoked_at);
  }).immediate();
  return { invite: asInvite(row), secret };
}

export function resolveTeamBoardInvite(store: StudioStore, secret: string): TeamBoardInvite {
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Board invitation is unavailable.');
  const hash = createHash('sha256').update(secret).digest('hex');
  const row = store.db.prepare('SELECT * FROM team_board_invites WHERE secret_hash = ?').get(hash) as InviteRow | undefined;
  if (!row || row.revoked_at || row.expires_at <= new Date().toISOString()) throw new Error('Board invitation is unavailable.');
  store.project(row.project_id);
  return asInvite(row);
}

export function revokeTeamBoardInvite(store: StudioStore, input: { projectId: string; inviteId: string }): TeamBoardInvite {
  store.project(input.projectId);
  const row = store.db.prepare('SELECT * FROM team_board_invites WHERE id = ? AND project_id = ?').get(input.inviteId, input.projectId) as InviteRow | undefined;
  if (!row) throw new Error('Board invitation does not belong to this project.');
  store.db.prepare('UPDATE team_board_invites SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL')
    .run(new Date().toISOString(), input.inviteId, input.projectId);
  return asInvite(store.db.prepare('SELECT * FROM team_board_invites WHERE id = ?').get(input.inviteId) as InviteRow);
}

function sharedTitle(value: string): string {
  const bounded = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 160);
  const checked = redactSensitiveText(bounded);
  return checked.redacted ? '[Sensitive title hidden]' : checked.text;
}

/** Only this explicit projection may leave the host; no paths, logs, descriptions, agents or credentials. */
export function teamBoardSnapshot(store: StudioStore, projectId: string): TeamBoardSnapshot {
  const project = store.project(projectId);
  const columns = store.db.prepare('SELECT id, name FROM columns WHERE project_id = ? ORDER BY position, id').all(projectId) as Array<{ id: string; name: string }>;
  const cards = store.db.prepare(`SELECT id, column_id, title, priority FROM cards
    WHERE project_id = ? AND archived_at IS NULL ORDER BY column_id, position, id LIMIT ?`)
    .all(projectId, MAX_CARDS + 1) as Array<{ id: string; column_id: string; title: string; priority: CardPriority }>;
  const running = store.db.prepare("SELECT card_id, started_at FROM sessions WHERE project_id = ? AND state = 'running' ORDER BY started_at DESC LIMIT 30")
    .all(projectId) as Array<{ card_id: string; started_at: string }>;
  const runningByCard = new Map(running.map((row) => [row.card_id, row.started_at]));
  return { projectName: sharedTitle(project.name), observedAt: new Date().toISOString(),
    columns: columns.map((item) => ({ id: item.id, name: sharedTitle(item.name) })),
    cards: cards.slice(0, MAX_CARDS).map((item) => ({ id: item.id, columnId: item.column_id,
      title: sharedTitle(item.title), priority: item.priority, runningSince: runningByCard.get(item.id) ?? null })),
    queueState: store.projectQueue(projectId).state, truncated: cards.length > MAX_CARDS };
}
