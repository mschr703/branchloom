import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { acceptTeamMemberInvite, addTeamProject, createTeamMemberInvite, createTeamWorkspace,
  revokeTeamMember, setTeamCapabilityGrant, setTeamProjectAccess,
  type TeamProjectMember } from '../../src/main/team-workspace';

it('shows only active members with actual access to the requested project', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-roster-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  let coordinator: TeamCoordinatorHttp | null = null;
  try {
    const project = store.createProject({ name: 'Shared project', path: root });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Shared workspace',
      projectId: project.id, ownerName: 'Owner' });
    const inviteMember = (role: 'editor' | 'developer' | 'viewer', displayName: string) =>
      acceptTeamMemberInvite(store.db,
        createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, role).secret,
        displayName);
    const editor = inviteMember('editor', 'Editor');
    const developer = inviteMember('developer', 'Developer');
    const viewer = inviteMember('viewer', 'Viewer');
    coordinator = new TeamCoordinatorHttp(store);
    const base = await coordinator.start();
    const roster = (key: string, projectId = project.id, origin?: string) =>
      fetch(`${base}/v1/projects/${projectId}/members`, { headers: {
        Authorization: `Bearer ${key}`, ...(origin ? { Origin: origin } : {}),
      } });
    const getMembers = async (key: string) => {
      const response = await roster(key);
      expect(response.status).toBe(200);
      return (await response.json() as { members: TeamProjectMember[] }).members;
    };

    const first = await getMembers(viewer.credential);
    expect(first).toHaveLength(4);
    expect(first.find((member) => member.id === owner.owner.id)).toMatchObject({
      displayName: 'Owner', role: 'owner', projectAccess: 'edit', canManageTask: true, canStartAgent: true,
    });
    expect(first.find((member) => member.id === editor.member.id)).toMatchObject({
      role: 'editor', projectAccess: 'edit', canEditDraft: true, canManageTask: false,
    });
    expect(first.find((member) => member.id === developer.member.id)).toMatchObject({
      role: 'developer', projectAccess: 'edit', canEditDraft: true, canManageTask: false,
    });
    expect(first.find((member) => member.id === viewer.member.id)).toEqual({
      id: viewer.member.id, displayName: 'Viewer', role: 'viewer', roleRevision: 0, projectAccess: 'read',
      canEditDraft: false, canManageTask: false, canStartAgent: false,
    });
    expect(JSON.stringify(first)).not.toContain(owner.credential);
    expect(JSON.stringify(first)).not.toContain(viewer.credential);

    setTeamCapabilityGrant(store.db, owner.credential, project.id, viewer.member.id, 'manage_task', true);
    expect((await getMembers(editor.credential)).find((member) => member.id === viewer.member.id))
      .toMatchObject({ projectAccess: 'edit', canManageTask: true });
    setTeamProjectAccess(store.db, owner.credential, project.id, viewer.member.id, 'read');
    expect((await getMembers(editor.credential)).find((member) => member.id === viewer.member.id))
      .toMatchObject({ projectAccess: 'read', canManageTask: false });
    setTeamProjectAccess(store.db, owner.credential, project.id, developer.member.id, 'none');
    expect((await getMembers(viewer.credential)).map((member) => member.id)).not.toContain(developer.member.id);
    expect((await roster(developer.credential)).status).toBe(403);
    revokeTeamMember(store.db, owner.credential, editor.member.id);
    expect((await getMembers(viewer.credential)).map((member) => member.id)).not.toContain(editor.member.id);
    expect((await roster(editor.credential)).status).toBe(401);
    expect((await roster('wrong')).status).toBe(401);
    expect((await roster(owner.credential, project.id, 'https://other.example')).status).toBe(403);

    const privatePath = join(root, 'private');
    mkdirSync(privatePath);
    const privateProject = store.createProject({ name: 'Private project', path: privatePath });
    addTeamProject(store.db, owner.credential, privateProject.id, true);
    expect((await roster(viewer.credential, privateProject.id)).status).toBe(403);
    expect((await roster(owner.credential, privateProject.id)).status).toBe(200);
    const privateMembers = await (await roster(owner.credential, privateProject.id)).json() as { members: TeamProjectMember[] };
    expect(privateMembers.members.map((member) => member.id)).toEqual([owner.owner.id]);
    setTeamProjectAccess(store.db, owner.credential, privateProject.id, viewer.member.id, 'read');
    const allowedPrivateMembers = await (await roster(viewer.credential, privateProject.id)).json() as { members: TeamProjectMember[] };
    expect(allowedPrivateMembers.members.map((member) => member.id).sort()).toEqual([owner.owner.id, viewer.member.id].sort());

    const unrelatedPath = join(root, 'unrelated');
    mkdirSync(unrelatedPath);
    const unrelated = store.createProject({ name: 'Unrelated project', path: unrelatedPath });
    createTeamWorkspace(store.db, { workspaceName: 'Other workspace', projectId: unrelated.id, ownerName: 'Other owner' });
    expect((await roster(viewer.credential, unrelated.id)).status).toBe(403);
  } finally {
    await coordinator?.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
