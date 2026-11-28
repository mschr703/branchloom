import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { acceptTeamMemberInvite, changeTeamMemberRole, createTeamMemberInvite, createTeamWorkspace,
  installTeamWorkspaces,
  listTeamProjectMembers, requireTeamProjectCapability, revokeTeamMember,
  setTeamCapabilityGrant, setTeamProjectAccess } from '../../src/main/team-workspace';

it('revises a member role once, clears prior grants, and rejects stale or unauthorized changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-role-'));
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  let coordinator: TeamCoordinatorHttp | null = null;
  try {
    const project = store.createProject({ name: 'Shared project', path: root });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Shared workspace', projectId: project.id, ownerName: 'Owner' });
    const editor = acceptTeamMemberInvite(store.db,
      createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'editor').secret, 'Editor');
    const admin = acceptTeamMemberInvite(store.db,
      createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'admin').secret, 'Admin');
    setTeamCapabilityGrant(store.db, owner.credential, project.id, editor.member.id, 'manage_task', true);
    setTeamProjectAccess(store.db, owner.credential, project.id, editor.member.id, 'edit');
    expect(requireTeamProjectCapability(store.db, editor.credential, project.id, 'manage_task').id).toBe(editor.member.id);
    coordinator = new TeamCoordinatorHttp(store);
    let base = await coordinator.start();
    const change = (credential: string, memberId: string, role: string, expectedRevision: number, mutationId: string) =>
      fetch(`${base}/v1/workspace/members/${memberId}/role`, { method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, expectedRevision, mutationId }),
      });
    const firstMutation = randomUUID();
    expect((await change(editor.credential, admin.member.id, 'viewer', 0, randomUUID())).status).toBe(403);
    expect((await change(admin.credential, editor.member.id, 'viewer', 0, randomUUID())).status).toBe(403);
    expect((await change(owner.credential, owner.owner.id, 'admin', 0, randomUUID())).status).toBe(400);
    expect((await change(owner.credential, editor.member.id, 'owner', 0, randomUUID())).status).toBe(400);
    const first = await change(owner.credential, editor.member.id, 'viewer', 0, firstMutation);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ memberId: editor.member.id, role: 'viewer', revision: 1, repeated: false });
    expect((await change(owner.credential, editor.member.id, 'viewer', 0, firstMutation)).status).toBe(200);
    expect((await change(owner.credential, editor.member.id, 'viewer', 1, firstMutation)).status).toBe(400);
    expect(await (await change(owner.credential, editor.member.id, 'viewer', 0, firstMutation)).json())
      .toMatchObject({ revision: 1, repeated: true });
    expect((await change(owner.credential, editor.member.id, 'admin', 0, firstMutation)).status).toBe(400);
    expect((await change(owner.credential, editor.member.id, 'admin', 0, randomUUID())).status).toBe(409);
    expect(listTeamProjectMembers(store.db, editor.credential, project.id).find((member) => member.id === editor.member.id))
      .toMatchObject({ role: 'viewer', roleRevision: 1, projectAccess: 'read', canManageTask: false });
    expect(() => requireTeamProjectCapability(store.db, editor.credential, project.id, 'manage_task')).toThrow('not permitted');
    expect((store.db.prepare('SELECT COUNT(*) AS count FROM team_project_capability_grants WHERE member_id = ?')
      .get(editor.member.id) as { count: number }).count).toBe(0);

    await coordinator.close();
    coordinator = null;
    store.close();
    const restarted = new StudioStore(file);
    try {
      coordinator = new TeamCoordinatorHttp(restarted);
      base = await coordinator.start();
      expect((await (await change(owner.credential, editor.member.id, 'viewer', 0, firstMutation)).json()))
        .toMatchObject({ revision: 1, repeated: true });
      expect((await change(owner.credential, editor.member.id, 'developer', 1, randomUUID())).status).toBe(200);
      expect(listTeamProjectMembers(restarted.db, owner.credential, project.id).find((member) => member.id === editor.member.id))
        .toMatchObject({ role: 'developer', roleRevision: 2, canManageTask: false, canEditDraft: true });
      revokeTeamMember(restarted.db, owner.credential, editor.member.id);
      expect((await change(owner.credential, editor.member.id, 'admin', 2, randomUUID())).status).toBe(400);
      const unrelatedPath = join(root, 'unrelated');
      mkdirSync(unrelatedPath);
      const unrelated = restarted.createProject({ name: 'Unrelated', path: unrelatedPath });
      const other = createTeamWorkspace(restarted.db, { workspaceName: 'Other', projectId: unrelated.id, ownerName: 'Other owner' });
      expect((await change(other.credential, admin.member.id, 'viewer', 0, randomUUID())).status).toBe(400);
    } finally { await coordinator?.close(); coordinator = null; restarted.close(); }
  } finally {
    await coordinator?.close();
    // The store may have been closed before the restart branch.
    try { store.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
});

it('adds a role revision to a preexisting team membership table', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE team_members (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, display_name TEXT NOT NULL,
      role TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL, revoked_at TEXT
    );`);
    installTeamWorkspaces(db);
    expect((db.pragma('table_info(team_members)') as Array<{ name: string }>).some((column) => column.name === 'role_revision'))
      .toBe(true);
    installTeamWorkspaces(db);
    expect((db.pragma('table_info(team_members)') as Array<{ name: string }>).filter((column) => column.name === 'role_revision'))
      .toHaveLength(1);
  } finally { db.close(); }
});

it('rejects stale role changes directly without changing the current member', () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-role-direct-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  try {
    const project = store.createProject({ name: 'Project', path: root });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Workspace', projectId: project.id, ownerName: 'Owner' });
    const viewer = acceptTeamMemberInvite(store.db,
      createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'viewer').secret, 'Viewer');
    const first = changeTeamMemberRole(store.db, { credential: owner.credential, memberId: viewer.member.id,
      role: 'editor', expectedRevision: 0, mutationId: randomUUID() });
    expect(first).toMatchObject({ role: 'editor', revision: 1, repeated: false });
    expect(() => changeTeamMemberRole(store.db, { credential: owner.credential, memberId: viewer.member.id,
      role: 'admin', expectedRevision: 0, mutationId: randomUUID() })).toThrow('role changed');
    expect(listTeamProjectMembers(store.db, owner.credential, project.id).find((member) => member.id === viewer.member.id))
      .toMatchObject({ role: 'editor', roleRevision: 1 });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
