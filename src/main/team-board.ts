import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CardPriority } from '../shared/types';
import type { CreatedTeamBoardInvite, TeamBoardComment, TeamBoardInvite, TeamBoardSnapshot } from '../shared/team-board';
import type { StudioStore } from './store';
import { redactSensitiveText } from './sensitive-content';

const MAX_CARDS = 200;
const MAX_ACTIVE_INVITES = 10;
const MAX_COMMENTS = 300;
const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;
type InviteRow = { id: string; project_id: string; display_name: string; role: 'viewer'; can_comment: number; secret_hash: string;
  created_at: string; expires_at: string; revoked_at: string | null };
type CommentRow = { id: string; project_id: string; card_id: string; card_title: string; invite_id: string;
  display_name: string; body: string; client_mutation_id: string; created_at: string };

export function installTeamBoard(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS team_board_invites (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role = 'viewer'), secret_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
  ); CREATE INDEX IF NOT EXISTS idx_team_board_invites_project ON team_board_invites(project_id, created_at DESC);`);
  const inviteColumns = db.pragma('table_info(team_board_invites)') as Array<{ name: string }>;
  if (!inviteColumns.some((column) => column.name === 'can_comment')) db.exec('ALTER TABLE team_board_invites ADD COLUMN can_comment INTEGER NOT NULL DEFAULT 0 CHECK(can_comment IN (0, 1))');
  db.exec(`CREATE TABLE IF NOT EXISTS team_board_comments (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    invite_id TEXT NOT NULL REFERENCES team_board_invites(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL, body TEXT NOT NULL, client_mutation_id TEXT NOT NULL,
    created_at TEXT NOT NULL, UNIQUE(invite_id, client_mutation_id)
  ); CREATE INDEX IF NOT EXISTS idx_team_board_comments_project ON team_board_comments(project_id, created_at DESC);`);
  // A listener's random port and in-memory allowlist do not survive an app restart.
  db.prepare('UPDATE team_board_invites SET revoked_at = ? WHERE revoked_at IS NULL').run(new Date().toISOString());
}

const asInvite = (row: InviteRow): TeamBoardInvite => ({ id: row.id, projectId: row.project_id,
  displayName: row.display_name, role: row.role, canComment: row.can_comment === 1, createdAt: row.created_at,
  expiresAt: row.expires_at, revokedAt: row.revoked_at });

export function teamBoardInvites(store: StudioStore, projectId: string): TeamBoardInvite[] {
  store.project(projectId);
  return (store.db.prepare('SELECT * FROM team_board_invites WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30')
    .all(projectId) as InviteRow[]).map(asInvite);
}

export function createTeamBoardInvite(store: StudioStore, input: { projectId: string; displayName: string; canComment?: boolean }): CreatedTeamBoardInvite {
  if (!input || typeof input.projectId !== 'string' || typeof input.displayName !== 'string') throw new Error('Project and guest name are required.');
  if (input.canComment !== undefined && typeof input.canComment !== 'boolean') throw new Error('Guest comment permission is invalid.');
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80 || /[\x00-\x1f\x7f]/.test(displayName)) throw new Error('Guest name must be 1–80 printable characters.');
  const secret = randomBytes(32).toString('base64url');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + INVITE_LIFETIME_MS).toISOString();
  const row: InviteRow = { id: randomUUID(), project_id: input.projectId, display_name: displayName,
    role: 'viewer', can_comment: input.canComment ? 1 : 0, secret_hash: createHash('sha256').update(secret).digest('hex'),
    created_at: createdAt, expires_at: expiresAt, revoked_at: null };
  store.db.transaction(() => {
    store.project(input.projectId);
    const active = store.db.prepare('SELECT COUNT(*) AS count FROM team_board_invites WHERE project_id = ? AND revoked_at IS NULL AND expires_at > ?')
      .get(input.projectId, createdAt) as { count: number };
    if (active.count >= MAX_ACTIVE_INVITES) throw new Error('Revoke an invitation before creating another one.');
    store.db.prepare('INSERT INTO team_board_invites (id, project_id, display_name, role, can_comment, secret_hash, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.project_id, row.display_name, row.role, row.can_comment, row.secret_hash, row.created_at, row.expires_at, row.revoked_at);
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

const asComment = (row: CommentRow): TeamBoardComment => ({ id: row.id, projectId: row.project_id,
  cardId: row.card_id, cardTitle: row.card_title, inviteId: row.invite_id,
  displayName: row.display_name, body: row.body, createdAt: row.created_at });

/** Host-only list. Guest responses never expose other guests' comments. */
export function teamBoardComments(store: StudioStore, projectId: string): TeamBoardComment[] {
  store.project(projectId);
  const rows = store.db.prepare(`SELECT comment.*, card.title AS card_title FROM team_board_comments AS comment
    JOIN cards AS card ON card.id = comment.card_id WHERE comment.project_id = ?
    ORDER BY comment.created_at DESC, comment.id DESC LIMIT 100`).all(projectId) as CommentRow[];
  return rows.map(asComment);
}

export function addTeamBoardComment(store: StudioStore, input: {
  secret: string; cardId: string; body: string; clientMutationId: string;
}): TeamBoardComment {
  const invite = resolveTeamBoardInvite(store, input?.secret);
  if (!invite.canComment) throw new Error('This invitation cannot comment.');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || body.length > 800 || body.includes('\0') || typeof input.cardId !== 'string'
    || typeof input.clientMutationId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(input.clientMutationId))
    throw new Error('Board comment is invalid.');
  return store.db.transaction(() => {
    const previous = store.db.prepare(`SELECT comment.*, card.title AS card_title FROM team_board_comments AS comment
      JOIN cards AS card ON card.id = comment.card_id WHERE comment.invite_id = ? AND comment.client_mutation_id = ?`)
      .get(invite.id, input.clientMutationId) as CommentRow | undefined;
    if (previous) {
      if (previous.card_id !== input.cardId || previous.body !== body) throw new Error('Board request ID was already used for different content.');
      return asComment(previous);
    }
    const card = store.db.prepare('SELECT project_id, title, archived_at FROM cards WHERE id = ?')
      .get(input.cardId) as { project_id: string; title: string; archived_at: string | null } | undefined;
    if (!card || card.project_id !== invite.projectId || card.archived_at) throw new Error('Board card is unavailable.');
    const count = store.db.prepare('SELECT COUNT(*) AS count FROM team_board_comments WHERE project_id = ?').get(invite.projectId) as { count: number };
    if (count.count >= MAX_COMMENTS) throw new Error('Board comment limit reached.');
    const row = { id: randomUUID(), project_id: invite.projectId, card_id: input.cardId,
      card_title: card.title, invite_id: invite.id, display_name: invite.displayName,
      body, client_mutation_id: input.clientMutationId, created_at: new Date().toISOString() };
    store.db.prepare(`INSERT INTO team_board_comments
      (id, project_id, card_id, invite_id, display_name, body, client_mutation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, row.project_id, row.card_id, row.invite_id,
      row.display_name, row.body, row.client_mutation_id, row.created_at);
    return asComment(row);
  }).immediate();
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
