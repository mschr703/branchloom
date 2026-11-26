import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CardPriority } from '../shared/types';
import type { StudioStore } from './store';

export type TeamRole = 'owner' | 'admin' | 'editor' | 'developer' | 'viewer';
export type TeamCapability = 'read' | 'edit' | 'edit_draft' | 'propose_plan' | 'accept_plan' | 'manage_task' |
  'start_agent' | 'integrate' | 'manage_members';
const CAPABILITIES: readonly TeamCapability[] = ['read', 'edit', 'edit_draft', 'propose_plan', 'accept_plan', 'manage_task',
  'start_agent', 'integrate', 'manage_members'];

export interface TeamMember {
  id: string;
  workspaceId: string;
  displayName: string;
  role: TeamRole;
  revokedAt: string | null;
}

export interface TeamAgentLaunch {
  state: 'pending' | 'dispatching' | 'started' | 'failed';
  agentId: string;
  sessionId: string | null;
}

type MemberRow = { id: string; workspace_id: string; display_name: string; role: TeamRole; revoked_at: string | null };
type InviteRow = { id: string; workspace_id: string; role: 'admin' | 'editor' | 'developer' | 'viewer'; expires_at: string;
  revoked_at: string | null; accepted_member_id: string | null; accepted_request_id: string | null };

const secret = (): string => randomBytes(32).toString('base64url');
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const validSecret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const member = (row: MemberRow): TeamMember => ({ id: row.id, workspaceId: row.workspace_id,
  displayName: row.display_name, role: row.role, revokedAt: row.revoked_at });
const name = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Name must be 1-80 printable characters.');
  }
  return value.trim();
};

/** Team credentials are distinct from short-lived guest-board links and stored only as hashes. */
export function installTeamWorkspaces(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS team_workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES team_workspaces(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','developer','viewer')),
    credential_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_team_members_workspace ON team_members(workspace_id, revoked_at);
  CREATE TABLE IF NOT EXISTS team_projects (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES team_workspaces(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_team_projects_workspace ON team_projects(workspace_id);
  CREATE TABLE IF NOT EXISTS team_project_permissions (
    project_id TEXT NOT NULL REFERENCES team_projects(project_id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    access TEXT NOT NULL CHECK(access IN ('none','read','edit')),
    PRIMARY KEY (project_id, member_id)
  );
  CREATE TABLE IF NOT EXISTS team_project_defaults (
    project_id TEXT PRIMARY KEY REFERENCES team_projects(project_id) ON DELETE CASCADE,
    access TEXT NOT NULL CHECK(access IN ('none','read','edit'))
  );
  CREATE TABLE IF NOT EXISTS team_project_capability_grants (
    project_id TEXT NOT NULL REFERENCES team_projects(project_id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
    capability TEXT NOT NULL, PRIMARY KEY (project_id, member_id, capability)
  );
  CREATE TABLE IF NOT EXISTS team_member_invites (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES team_workspaces(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('admin','editor','developer','viewer')), secret_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
    accepted_member_id TEXT REFERENCES team_members(id), accepted_request_id TEXT
  );
  CREATE TABLE IF NOT EXISTS team_card_commands (
    workspace_id TEXT NOT NULL REFERENCES team_workspaces(id) ON DELETE CASCADE,
    mutation_id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES team_members(id),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    command TEXT NOT NULL, payload_json TEXT NOT NULL,
    base_revision INTEGER NOT NULL, committed_revision INTEGER NOT NULL,
    created_at TEXT NOT NULL, PRIMARY KEY (workspace_id, mutation_id)
  );
  CREATE TABLE IF NOT EXISTS team_agent_launches (
    workspace_id TEXT NOT NULL REFERENCES team_workspaces(id) ON DELETE CASCADE,
    mutation_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','dispatching','started','failed')),
    session_id TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, mutation_id)
  );
  CREATE TABLE IF NOT EXISTS team_card_drafts (
    card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    state BLOB NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS team_card_draft_mutations (
    workspace_id TEXT NOT NULL REFERENCES team_workspaces(id) ON DELETE CASCADE,
    mutation_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    update_hash TEXT NOT NULL, revision INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, mutation_id)
  );`);
}

/** A revisioned business command. Free-form collaborative text uses a separate document path. */
export function setTeamCardPriority(store: StudioStore, input: {
  credential: string; projectId: string; cardId: string; priority: CardPriority;
  expectedRevision: number; mutationId: string;
}): { cardId: string; revision: number; priority: CardPriority; repeated: boolean } {
  if (!input || typeof input.mutationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.mutationId) ||
    !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('Invalid team card command.');
  return store.db.transaction(() => {
    const actor = requireTeamProjectCapability(store.db, input.credential, input.projectId, 'manage_task');
    const payload = JSON.stringify({ priority: input.priority });
    const previous = store.db.prepare(`SELECT actor_id, project_id, card_id, command, payload_json, committed_revision
      FROM team_card_commands WHERE workspace_id = ? AND mutation_id = ?`)
      .get(actor.workspaceId, input.mutationId) as { actor_id: string; project_id: string; card_id: string;
        command: string; payload_json: string; committed_revision: number } | undefined;
    if (previous) {
      if (previous.actor_id !== actor.id || previous.project_id !== input.projectId || previous.card_id !== input.cardId ||
        previous.command !== 'set_priority' || previous.payload_json !== payload) throw new Error('Mutation ID was already used for another action.');
      return { cardId: input.cardId, revision: previous.committed_revision, priority: input.priority, repeated: true };
    }
    const card = store.card(input.cardId);
    if (card.projectId !== input.projectId || card.archivedAt) throw new Error('Team card is unavailable.');
    const current = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number };
    if (current.content_revision !== input.expectedRevision) throw new Error('Card changed. Reload before applying this team action.');
    store.updateCard({ id: card.id, priority: input.priority });
    const after = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number };
    store.db.prepare(`INSERT INTO team_card_commands (workspace_id, mutation_id, actor_id, project_id, card_id,
      command, payload_json, base_revision, committed_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(actor.workspaceId, input.mutationId, actor.id, input.projectId, card.id, 'set_priority', payload,
        current.content_revision, after.content_revision, new Date().toISOString());
    return { cardId: card.id, revision: after.content_revision, priority: input.priority, repeated: false };
  }).immediate();
}

export function teamAgentLaunch(db: Database.Database, workspaceId: string, mutationId: string): TeamAgentLaunch | null {
  const row = db.prepare(`SELECT state, agent_id AS agentId, session_id AS sessionId FROM team_agent_launches
    WHERE workspace_id = ? AND mutation_id = ?`).get(workspaceId, mutationId) as TeamAgentLaunch | undefined;
  return row ?? null;
}

/** Once claimed, an uncertain launch stays visible and is never replayed on retry or restart. */
export function claimTeamAgentLaunch(db: Database.Database, workspaceId: string, mutationId: string): boolean {
  return db.prepare("UPDATE team_agent_launches SET state = 'dispatching' WHERE workspace_id = ? AND mutation_id = ? AND state = 'pending'")
    .run(workspaceId, mutationId).changes === 1;
}

export function finishTeamAgentLaunch(db: Database.Database, workspaceId: string, mutationId: string,
  sessionId: string | null): void {
  const changed = db.prepare(`UPDATE team_agent_launches SET state = ?, session_id = ?
    WHERE workspace_id = ? AND mutation_id = ? AND state = 'dispatching'`)
    .run(sessionId ? 'started' : 'failed', sessionId, workspaceId, mutationId);
  if (changed.changes !== 1) throw new Error('Team agent launch is no longer dispatching.');
}

/** Moving a shared card is revisioned; an auto-start is a separately recorded host action. */
export function moveTeamCard(store: StudioStore, input: {
  credential: string; projectId: string; cardId: string; columnId: string;
  expectedRevision: number; mutationId: string; agentStarterAvailable?: boolean;
}): { cardId: string; columnId: string; revision: number; repeated: boolean; agentLaunch: TeamAgentLaunch | null } {
  if (!input || typeof input.columnId !== 'string' || !input.columnId ||
    typeof input.mutationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.mutationId) ||
    !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error('Invalid team card command.');
  return store.db.transaction(() => {
    const actor = requireTeamProjectCapability(store.db, input.credential, input.projectId, 'manage_task');
    const payload = JSON.stringify({ columnId: input.columnId });
    const previous = store.db.prepare(`SELECT actor_id, project_id, card_id, command, payload_json, committed_revision
      FROM team_card_commands WHERE workspace_id = ? AND mutation_id = ?`)
      .get(actor.workspaceId, input.mutationId) as { actor_id: string; project_id: string; card_id: string;
        command: string; payload_json: string; committed_revision: number } | undefined;
    if (previous) {
      if (previous.actor_id !== actor.id || previous.project_id !== input.projectId || previous.card_id !== input.cardId ||
        previous.command !== 'move_card' || previous.payload_json !== payload) throw new Error('Mutation ID was already used for another action.');
      return { cardId: input.cardId, columnId: input.columnId, revision: previous.committed_revision,
        repeated: true, agentLaunch: teamAgentLaunch(store.db, actor.workspaceId, input.mutationId) };
    }
    const card = store.card(input.cardId);
    if (card.projectId !== input.projectId || card.archivedAt) throw new Error('Team card is unavailable.');
    const column = store.column(input.columnId);
    if (column.projectId !== input.projectId) throw new Error('Team column is unavailable.');
    if (column.autoStart) {
      requireTeamProjectCapability(store.db, input.credential, input.projectId, 'start_agent');
      if (!column.agentId || !input.agentStarterAvailable) throw new Error('Team agent worker is unavailable.');
    }
    const current = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number };
    if (current.content_revision !== input.expectedRevision) throw new Error('Card changed. Reload before applying this team action.');
    if (store.projectQueue(input.projectId).state === 'running' ||
      store.db.prepare("SELECT 1 FROM sessions WHERE card_id = ? AND state = 'running' LIMIT 1").get(card.id) ||
      store.db.prepare("SELECT 1 FROM workflows WHERE project_id = ? AND state IN ('running', 'paused') AND card_ids_json LIKE ? LIMIT 1")
        .get(input.projectId, `%"${card.id}"%`)) throw new Error('Team card is active. Pause the queue and finish its run before moving it.');
    if (card.columnId === column.id) throw new Error('Team card is already in this column.');
    store.moveCard({ id: card.id, columnId: column.id });
    store.db.prepare('UPDATE cards SET content_revision = content_revision + 1 WHERE id = ?').run(card.id);
    const after = current.content_revision + 1;
    store.db.prepare(`INSERT INTO team_card_commands (workspace_id, mutation_id, actor_id, project_id, card_id,
      command, payload_json, base_revision, committed_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(actor.workspaceId, input.mutationId, actor.id, input.projectId, card.id, 'move_card', payload,
        current.content_revision, after, new Date().toISOString());
    if (column.autoStart && column.agentId) store.db.prepare(`INSERT INTO team_agent_launches
      (workspace_id, mutation_id, project_id, card_id, agent_id, state, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(actor.workspaceId, input.mutationId, input.projectId, card.id, column.agentId, new Date().toISOString());
    return { cardId: card.id, columnId: column.id, revision: after,
      repeated: false, agentLaunch: teamAgentLaunch(store.db, actor.workspaceId, input.mutationId) };
  }).immediate();
}

export function createTeamWorkspace(db: Database.Database, input: { workspaceName: string; projectId: string; ownerName: string }): {
  workspaceId: string; owner: TeamMember; credential: string;
} {
  if (!input || typeof input.projectId !== 'string' || !input.projectId) throw new Error('Project is required.');
  const workspaceName = name(input.workspaceName);
  const ownerName = name(input.ownerName);
  const workspaceId = randomUUID();
  const ownerId = randomUUID();
  const credential = secret();
  const createdAt = new Date().toISOString();
  db.transaction(() => {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(input.projectId);
    if (!project) throw new Error('Project is unavailable.');
    db.prepare('INSERT INTO team_workspaces (id, name, created_at) VALUES (?, ?, ?)').run(workspaceId, workspaceName, createdAt);
    db.prepare("INSERT INTO team_members (id, workspace_id, display_name, role, credential_hash, created_at) VALUES (?, ?, ?, 'owner', ?, ?)")
      .run(ownerId, workspaceId, ownerName, hash(credential), createdAt);
    db.prepare('INSERT INTO team_projects (project_id, workspace_id, added_at) VALUES (?, ?, ?)')
      .run(input.projectId, workspaceId, createdAt);
  }).immediate();
  return { workspaceId, owner: { id: ownerId, workspaceId, displayName: ownerName, role: 'owner', revokedAt: null }, credential };
}

export function authenticateTeamMember(db: Database.Database, credential: string): TeamMember {
  if (!validSecret(credential)) throw new Error('Team credential is unavailable.');
  const row = db.prepare('SELECT id, workspace_id, display_name, role, revoked_at FROM team_members WHERE credential_hash = ?')
    .get(hash(credential)) as MemberRow | undefined;
  if (!row || row.revoked_at) throw new Error('Team credential is unavailable.');
  return member(row);
}

function allowed(role: TeamRole, capability: TeamCapability): boolean {
  if (role === 'owner') return true;
  if (role === 'admin') return ['read', 'edit', 'edit_draft', 'propose_plan', 'accept_plan', 'manage_task', 'start_agent'].includes(capability);
  if (role === 'editor') return ['read', 'edit', 'edit_draft', 'propose_plan'].includes(capability);
  if (role === 'developer') return ['read', 'edit_draft'].includes(capability);
  return capability === 'read';
}

export function requireTeamProjectCapability(db: Database.Database, credential: string, projectId: string,
  capability: TeamCapability): TeamMember {
  if (!CAPABILITIES.includes(capability)) throw new Error('Invalid team capability.');
  const actor = authenticateTeamMember(db, credential);
  const linked = db.prepare('SELECT 1 FROM team_projects WHERE project_id = ? AND workspace_id = ?').get(projectId, actor.workspaceId);
  const override = db.prepare('SELECT access FROM team_project_permissions WHERE project_id = ? AND member_id = ?')
    .get(projectId, actor.id) as { access: 'none' | 'read' | 'edit' } | undefined;
  const projectDefault = db.prepare('SELECT access FROM team_project_defaults WHERE project_id = ?')
    .get(projectId) as { access: 'none' | 'read' | 'edit' } | undefined;
  const effectiveAccess = override?.access ?? projectDefault?.access ?? 'edit';
  const permittedByProject = actor.role === 'owner' || effectiveAccess === 'edit' ||
    (effectiveAccess === 'read' && capability === 'read');
  const granted = storeGrant(db, projectId, actor.id, capability);
  if (!linked || !permittedByProject || (!allowed(actor.role, capability) && !granted)) throw new Error('Team member is not permitted for this project action.');
  return actor;
}

function storeGrant(db: Database.Database, projectId: string, memberId: string, capability: TeamCapability): boolean {
  return Boolean(db.prepare('SELECT 1 FROM team_project_capability_grants WHERE project_id = ? AND member_id = ? AND capability = ?')
    .get(projectId, memberId, capability));
}

/** Only the owner can add or remove an extra project capability. Draft proposals remain separate. */
export function setTeamCapabilityGrant(db: Database.Database, ownerCredential: string, projectId: string,
  memberId: string, capability: TeamCapability, grant: boolean): void {
  if (!CAPABILITIES.includes(capability) || capability === 'read' || typeof grant !== 'boolean') throw new Error('Invalid capability grant.');
  const actor = requireTeamProjectCapability(db, ownerCredential, projectId, 'manage_members');
  if (actor.role !== 'owner') throw new Error('Only the owner can grant extra capabilities.');
  db.transaction(() => {
    const target = db.prepare('SELECT workspace_id, role, revoked_at FROM team_members WHERE id = ?')
      .get(memberId) as Pick<MemberRow, 'workspace_id' | 'role' | 'revoked_at'> | undefined;
    if (!target || target.workspace_id !== actor.workspaceId || target.revoked_at || target.role === 'owner') {
      throw new Error('Team member is unavailable for a capability grant.');
    }
    if (grant) db.prepare('INSERT OR IGNORE INTO team_project_capability_grants (project_id, member_id, capability) VALUES (?, ?, ?)')
      .run(projectId, memberId, capability);
    else db.prepare('DELETE FROM team_project_capability_grants WHERE project_id = ? AND member_id = ? AND capability = ?')
      .run(projectId, memberId, capability);
  }).immediate();
}

export function addTeamProject(db: Database.Database, actorCredential: string, projectId: string,
  privateByDefault = false): void {
  const actor = authenticateTeamMember(db, actorCredential);
  if (actor.role !== 'owner') throw new Error('Only a team owner can add a project.');
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('Project is unavailable.');
    if (db.prepare('SELECT 1 FROM team_projects WHERE project_id = ?').get(projectId)) throw new Error('Project already belongs to a team.');
    db.prepare('INSERT INTO team_projects (project_id, workspace_id, added_at) VALUES (?, ?, ?)')
      .run(projectId, actor.workspaceId, new Date().toISOString());
    if (privateByDefault) db.prepare('INSERT INTO team_project_defaults (project_id, access) VALUES (?, ?)')
      .run(projectId, 'none');
  }).immediate();
}

/** A project override can change the project default but cannot exceed the member's team role. */
export function setTeamProjectAccess(db: Database.Database, actorCredential: string, projectId: string,
  memberId: string, access: 'none' | 'read' | 'edit' | null): void {
  if (access !== null && access !== 'none' && access !== 'read' && access !== 'edit') throw new Error('Invalid project access.');
  const actor = requireTeamProjectCapability(db, actorCredential, projectId, 'manage_members');
  db.transaction(() => {
    const target = db.prepare('SELECT id, workspace_id, role, revoked_at FROM team_members WHERE id = ?')
      .get(memberId) as Pick<MemberRow, 'id' | 'workspace_id' | 'role' | 'revoked_at'> | undefined;
    if (!target || target.workspace_id !== actor.workspaceId || target.revoked_at || target.role === 'owner') {
      throw new Error('Team member is unavailable for project access.');
    }
    if (target.role === 'viewer' && access === 'edit') throw new Error('Project access cannot exceed the team role.');
    if (access === null) {
      db.prepare('DELETE FROM team_project_permissions WHERE project_id = ? AND member_id = ?').run(projectId, memberId);
    } else {
      db.prepare(`INSERT INTO team_project_permissions (project_id, member_id, access) VALUES (?, ?, ?)
        ON CONFLICT(project_id, member_id) DO UPDATE SET access = excluded.access`).run(projectId, memberId, access);
    }
  }).immediate();
}

export function createTeamMemberInvite(db: Database.Database, actorCredential: string, workspaceId: string,
  role: 'admin' | 'editor' | 'developer' | 'viewer'): { inviteId: string; secret: string; expiresAt: string } {
  if (!['admin', 'editor', 'developer', 'viewer'].includes(role)) throw new Error('Invalid invited team role.');
  const actor = authenticateTeamMember(db, actorCredential);
  if (actor.workspaceId !== workspaceId || !allowed(actor.role, 'manage_members')) throw new Error('Team member cannot invite others.');
  const inviteId = randomUUID();
  const inviteSecret = secret();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  db.transaction(() => {
    const active = db.prepare(`SELECT COUNT(*) AS count FROM team_member_invites
      WHERE workspace_id = ? AND revoked_at IS NULL AND accepted_member_id IS NULL AND expires_at > ?`)
      .get(workspaceId, createdAt) as { count: number };
    if (active.count >= 20) throw new Error('Revoke an invitation before creating another.');
    db.prepare('INSERT INTO team_member_invites (id, workspace_id, role, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(inviteId, workspaceId, role, hash(inviteSecret), createdAt, expiresAt);
  }).immediate();
  return { inviteId, secret: inviteSecret, expiresAt };
}

export function revokeTeamMemberInvite(db: Database.Database, actorCredential: string, inviteId: string): void {
  const actor = authenticateTeamMember(db, actorCredential);
  if (!allowed(actor.role, 'manage_members')) throw new Error('Team member cannot revoke invitations.');
  const changed = db.prepare(`UPDATE team_member_invites SET revoked_at = ?
    WHERE id = ? AND workspace_id = ? AND accepted_member_id IS NULL AND revoked_at IS NULL`)
    .run(new Date().toISOString(), inviteId, actor.workspaceId);
  if (changed.changes !== 1) throw new Error('Team invitation is unavailable.');
}

export function acceptTeamMemberInvite(db: Database.Database, inviteSecret: string, displayName: string): {
  member: TeamMember; credential: string;
} {
  const credential = secret();
  const member = claimTeamMemberInvite(db, { inviteSecret, displayName, credential, requestId: randomUUID() });
  return { member, credential };
}

/** The client chooses and retains its credential before the network request, so an uncertain reply is retryable. */
export function claimTeamMemberInvite(db: Database.Database, input: {
  inviteSecret: string; displayName: string; credential: string; requestId: string;
}): TeamMember {
  if (!input || !validSecret(input.inviteSecret) || !validSecret(input.credential) ||
    typeof input.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)) {
    throw new Error('Team invitation is unavailable.');
  }
  const checkedName = name(input.displayName);
  const joinedAt = new Date().toISOString();
  return db.transaction(() => {
    const invite = db.prepare('SELECT * FROM team_member_invites WHERE secret_hash = ?')
      .get(hash(input.inviteSecret)) as InviteRow | undefined;
    if (!invite || invite.revoked_at || invite.expires_at <= joinedAt) throw new Error('Team invitation is unavailable.');
    if (invite.accepted_member_id) {
      const existing = db.prepare('SELECT id, workspace_id, display_name, role, revoked_at, credential_hash FROM team_members WHERE id = ?')
        .get(invite.accepted_member_id) as (MemberRow & { credential_hash: string }) | undefined;
      if (invite.accepted_request_id !== input.requestId || !existing || existing.revoked_at ||
        existing.credential_hash !== hash(input.credential) || existing.display_name !== checkedName) {
        throw new Error('Team invitation is unavailable.');
      }
      return member(existing);
    }
    const memberId = randomUUID();
    db.prepare('INSERT INTO team_members (id, workspace_id, display_name, role, credential_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(memberId, invite.workspace_id, checkedName, invite.role, hash(input.credential), joinedAt);
    db.prepare(`UPDATE team_member_invites SET accepted_member_id = ?, accepted_request_id = ?
      WHERE id = ? AND accepted_member_id IS NULL`).run(memberId, input.requestId, invite.id);
    return { id: memberId, workspaceId: invite.workspace_id, displayName: checkedName, role: invite.role, revokedAt: null };
  }).immediate();
}

export function revokeTeamMember(db: Database.Database, actorCredential: string, memberId: string): void {
  const actor = authenticateTeamMember(db, actorCredential);
  if (!allowed(actor.role, 'manage_members') || actor.id === memberId) throw new Error('Team member cannot be removed.');
  const changed = db.prepare("UPDATE team_members SET revoked_at = ? WHERE id = ? AND workspace_id = ? AND role != 'owner' AND revoked_at IS NULL")
    .run(new Date().toISOString(), memberId, actor.workspaceId);
  if (changed.changes !== 1) throw new Error('Team member is unavailable.');
}
