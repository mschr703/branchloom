import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';
import { TeamLocalService } from '../../src/main/team-local-service';
import { TeamRemoteClient } from '../../src/main/team-remote-client';
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
