import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';
import { TeamRemoteClient } from '../../src/main/team-remote-client';
import { createTeamMemberInvite, createTeamWorkspace, revokeTeamMember } from '../../src/main/team-workspace';
import { StudioStore } from '../../src/main/store';

const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`sealed:${[...value].reverse().join('')}`),
  decryptStringAsync: async (value: Buffer) => {
    if (!value.toString().startsWith('sealed:')) throw new Error('Invalid ciphertext');
    return { result: [...value.toString().slice(7)].reverse().join(''), shouldReEncrypt: false };
  },
};

it('resumes a lost invitation reply with the same credential and recognizes later revocation', async () => {
  const hostRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-host-'));
  const memberRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-member-'));
  const store = new StudioStore(join(hostRoot, 'studio.sqlite'));
  const server = new TeamCoordinatorHttp(store);
  try {
    const project = store.createProject({ name: 'Synthetic project', path: hostRoot });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Sample team', projectId: project.id, ownerName: 'Owner' });
    const invite = createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'editor');
    const coordinatorUrl = await server.start();
    let dropped = false;
    const unreliableFetch: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!dropped && String(input).endsWith('/v1/invitations/accept')) {
        dropped = true;
        await response.arrayBuffer();
        throw new Error('Simulated lost response');
      }
      return response;
    };
    const first = new TeamRemoteClient(new TeamConnectionStore(memberRoot, secure),
      new TeamJoinAttemptStore(memberRoot, secure), unreliableFetch);
    await expect(first.beginJoin({ coordinatorUrl, inviteSecret: invite.secret, displayName: 'Colleague' }))
      .rejects.toThrow('Retry the saved invitation');
    const pendingFile = readFileSync(join(memberRoot, 'team-join-pending.bin')).toString();
    expect(pendingFile).not.toContain(invite.secret);
    const resumed = new TeamRemoteClient(new TeamConnectionStore(memberRoot, secure),
      new TeamJoinAttemptStore(memberRoot, secure));
    expect(await resumed.pendingJoin()).toEqual({ coordinatorUrl, displayName: 'Colleague' });
    const joined = await resumed.resumeJoin();
    expect(joined.workspaceId).toBe(owner.workspaceId);
    expect((await resumed.workspace(joined.workspaceId)).projects).toEqual([{ id: project.id, name: project.name }]);
    expect((store.db.prepare('SELECT COUNT(*) AS count FROM team_members').get() as { count: number }).count).toBe(2);
    expect(await resumed.pendingJoin()).toBeNull();
    revokeTeamMember(store.db, owner.credential, joined.memberId);
    await expect(resumed.workspace(joined.workspaceId)).rejects.toThrow('revoked');
  } finally {
    await server.close();
    store.close();
    rmSync(hostRoot, { recursive: true, force: true });
    rmSync(memberRoot, { recursive: true, force: true });
  }
});
