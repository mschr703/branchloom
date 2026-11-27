import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';
import { TeamLocalService } from '../../src/main/team-local-service';
import { TeamRemoteClient } from '../../src/main/team-remote-client';
import { acceptTeamMemberInvite, requireTeamProjectCapability } from '../../src/main/team-workspace';
import { StudioStore } from '../../src/main/store';

const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`sealed:${value}`),
  decryptStringAsync: async (value: Buffer) => ({ result: value.toString().slice(7), shouldReEncrypt: false }),
};

it('hosts a project, refreshes the loopback port after restart, and revokes a joined member', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-host-service-'));
  const guestRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-guest-service-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const connections = new TeamConnectionStore(root, secure);
  let host = new TeamLocalService(store, connections);
  try {
    const project = store.createProject({ name: 'Sample', path: root });
    const workspace = await host.create({ projectId: project.id, workspaceName: 'Team', ownerName: 'Owner' });
    expect(workspace.members.map((member) => member.role)).toEqual(['owner']);
    await expect(host.create({ projectId: project.id, workspaceName: 'Other', ownerName: 'Owner' }))
      .rejects.toThrow('already belongs');
    await host.close();
    host = new TeamLocalService(store, connections);
    const resumed = await host.hostedProject(project.id);
    expect(resumed?.workspaceId).toBe(workspace.workspaceId);
    expect(resumed?.coordinatorUrl).toBe(workspace.coordinatorUrl);
    const invite = await host.invite(project.id, 'editor');
    expect(invite.coordinatorUrl).toBe(resumed?.coordinatorUrl);
    const guest = new TeamRemoteClient(new TeamConnectionStore(guestRoot, secure), new TeamJoinAttemptStore(guestRoot, secure));
    const member = await guest.beginJoin({ coordinatorUrl: invite.coordinatorUrl,
      inviteSecret: invite.inviteSecret, displayName: 'Colleague' });
    expect((await guest.workspace(member.workspaceId)).projects.map((item) => item.id)).toEqual([project.id]);
    expect((await host.hostedProject(project.id))?.members).toHaveLength(2);
    const secondPath = join(root, 'second'); mkdirSync(secondPath);
    const second = store.createProject({ name: 'Second project', path: secondPath });
    const linked = await host.addProject(second.id, workspace.workspaceId);
    expect(linked.defaultMemberAccess).toBe('none');
    expect((await host.ownedWorkspaces())[0]).toMatchObject({ workspaceId: workspace.workspaceId, projectCount: 2, memberCount: 2 });
    expect((await guest.workspace(member.workspaceId)).projects.map((item) => item.id)).toEqual([project.id]);
    await host.setProjectAccess(second.id, member.memberId, 'read');
    expect((await guest.workspace(member.workspaceId)).projects.map((item) => item.id)).toContain(second.id);
    await host.setProjectAccess(second.id, member.memberId, null);
    expect((await guest.workspace(member.workspaceId)).projects.map((item) => item.id)).toEqual([project.id]);
    const laterInvite = await host.invite(second.id, 'viewer');
    const laterGuest = acceptTeamMemberInvite(store.db, laterInvite.inviteSecret, 'Later viewer');
    expect(() => requireTeamProjectCapability(store.db, laterGuest.credential, second.id, 'read')).toThrow('not permitted');
    expect(requireTeamProjectCapability(store.db, laterGuest.credential, project.id, 'read').id).toBe(laterGuest.member.id);
    const narrowed = await host.setProjectAccess(project.id, member.memberId, 'read');
    expect(narrowed.members.find((item) => item.id === member.memberId)?.projectAccess).toBe('read');
    expect((await guest.workspace(member.workspaceId)).projects[0]?.canManageTask).toBe(false);
    await host.setProjectAccess(project.id, member.memberId, null);
    const granted = await host.setCapabilityGrant(project.id, member.memberId, 'manage_task', true);
    expect(granted.members.find((item) => item.id === member.memberId)?.extraCapabilities).toContain('manage_task');
    expect((await guest.workspace(member.workspaceId)).projects[0]?.canManageTask).toBe(true);
    await host.close();
    host = new TeamLocalService(store, connections);
    expect((await host.hostedProject(project.id))?.members.find((item) => item.id === member.memberId)?.extraCapabilities)
      .toContain('manage_task');
    await host.setCapabilityGrant(project.id, member.memberId, 'manage_task', false);
    expect((await guest.workspace(member.workspaceId)).projects[0]?.canManageTask).toBe(false);
    const afterRevoke = await host.revoke(project.id, member.memberId);
    expect(afterRevoke.members.find((item) => item.id === member.memberId)?.revokedAt).toBeTruthy();
    await expect(guest.workspace(member.workspaceId)).rejects.toThrow('revoked');
  } finally {
    await host.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(guestRoot, { recursive: true, force: true });
  }
});

it('does not restart a local host or mutate local workspace data for a remote HTTPS connection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-host-boundary-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const connections = new TeamConnectionStore(root, secure);
  let host = new TeamLocalService(store, connections);
  try {
    const project = store.createProject({ name: 'Sample', path: root });
    const workspace = await host.create({ projectId: project.id, workspaceName: 'Team', ownerName: 'Owner' });
    await host.close();
    const owner = await connections.get(workspace.workspaceId);
    expect(owner).not.toBeNull();
    await connections.save({ ...owner!, coordinatorUrl: 'https://team.example.com' });
    host = new TeamLocalService(store, connections);
    expect(await host.resumeSavedHost()).toBeNull();
    expect(await host.ownedWorkspaces()).toEqual([]);
    await expect(host.hostedProject(project.id)).rejects.toThrow('does not hold');
    await expect(host.addProject(project.id, workspace.workspaceId)).rejects.toThrow('Local team workspace owner credential');
  } finally {
    await host.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
