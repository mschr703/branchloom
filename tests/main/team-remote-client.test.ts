import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';
import { TeamRemoteClient } from '../../src/main/team-remote-client';
import { createTeamMemberInvite, createTeamWorkspace, revokeTeamMember,
  setTeamCapabilityGrant, setTeamProjectAccess } from '../../src/main/team-workspace';
import { StudioStore } from '../../src/main/store';
import { TeamLocalService } from '../../src/main/team-local-service';
import * as Y from 'yjs';

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
    expect((await resumed.workspace(joined.workspaceId)).projects).toEqual([{ id: project.id, name: project.name, canEditDraft: true }]);
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

it('merges two authenticated clients on one card draft and reconnects after host restart', async () => {
  const hostRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-live-host-'));
  const firstRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-live-first-'));
  const secondRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-live-second-'));
  const store = new StudioStore(join(hostRoot, 'studio.sqlite'));
  const hostConnections = new TeamConnectionStore(hostRoot, secure);
  let host = new TeamLocalService(store, hostConnections);
  try {
    const project = store.createProject({ name: 'Shared project', path: hostRoot });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
      title: 'Plan the first release', description: 'Accepted description' });
    const workspace = await host.create({ projectId: project.id, workspaceName: 'Team', ownerName: 'Owner' });
    const firstInvite = await host.invite(project.id, 'editor');
    const secondInvite = await host.invite(project.id, 'editor');
    const first = new TeamRemoteClient(new TeamConnectionStore(firstRoot, secure), new TeamJoinAttemptStore(firstRoot, secure));
    const second = new TeamRemoteClient(new TeamConnectionStore(secondRoot, secure), new TeamJoinAttemptStore(secondRoot, secure));
    await first.beginJoin({ coordinatorUrl: firstInvite.coordinatorUrl, inviteSecret: firstInvite.inviteSecret, displayName: 'Alex' });
    await second.beginJoin({ coordinatorUrl: secondInvite.coordinatorUrl, inviteSecret: secondInvite.inviteSecret, displayName: 'Sam' });
    expect((await second.board({ workspaceId: workspace.workspaceId, projectId: project.id })).cards)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: card.id, title: 'Plan the first release', revision: 0 })]));
    const alex = new Y.Doc(); const sam = new Y.Doc();
    alex.getText('body').insert(0, 'Review the empty state. ');
    sam.getText('body').insert(0, 'Check keyboard access. ');
    const firstUpdate = Buffer.from(Y.encodeStateAsUpdate(alex)).toString('base64');
    const secondUpdate = Buffer.from(Y.encodeStateAsUpdate(sam)).toString('base64');
    expect((await first.updateCardDraft({ workspaceId: workspace.workspaceId, projectId: project.id,
      cardId: card.id, mutationId: randomUUID(), update: firstUpdate })).revision).toBe(1);
    expect((await second.updateCardDraft({ workspaceId: workspace.workspaceId, projectId: project.id,
      cardId: card.id, mutationId: randomUUID(), update: secondUpdate })).revision).toBe(2);
    const merged = await first.cardDraft({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id });
    Y.applyUpdate(alex, Buffer.from(merged.update, 'base64'));
    expect(alex.getText('body').toString()).toContain('Review the empty state.');
    expect(alex.getText('body').toString()).toContain('Check keyboard access.');
    expect(store.snapshot(project.id).cards.find((item) => item.id === card.id)?.description).toBe('Accepted description');
    await host.close();
    host = new TeamLocalService(store, hostConnections);
    expect(await host.resumeSavedHost()).toBe(workspace.coordinatorUrl);
    expect((await host.hostedProject(project.id))?.coordinatorUrl).toBe(workspace.coordinatorUrl);
    expect((await second.cardDraft({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id })).revision).toBe(2);
    alex.destroy(); sam.destroy();
  } finally {
    await host.close(); store.close();
    rmSync(hostRoot, { recursive: true, force: true });
    rmSync(firstRoot, { recursive: true, force: true });
    rmSync(secondRoot, { recursive: true, force: true });
  }
});

it('reports the current project draft permission to a viewer after grants and restrictions', async () => {
  const hostRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-permission-host-'));
  const guestRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-permission-guest-'));
  const store = new StudioStore(join(hostRoot, 'studio.sqlite'));
  const server = new TeamCoordinatorHttp(store);
  try {
    const project = store.createProject({ name: 'Rights project', path: hostRoot });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Team', projectId: project.id, ownerName: 'Owner' });
    const invite = createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'viewer');
    const coordinatorUrl = await server.start();
    const guest = new TeamRemoteClient(new TeamConnectionStore(guestRoot, secure), new TeamJoinAttemptStore(guestRoot, secure));
    const joined = await guest.beginJoin({ coordinatorUrl, inviteSecret: invite.secret, displayName: 'Reader' });
    const projectRights = async () => (await guest.workspace(owner.workspaceId)).projects[0]?.canEditDraft;
    expect(await projectRights()).toBe(false);
    setTeamCapabilityGrant(store.db, owner.credential, project.id, joined.memberId, 'edit_draft', true);
    expect(await projectRights()).toBe(true);
    setTeamProjectAccess(store.db, owner.credential, project.id, joined.memberId, 'read');
    expect(await projectRights()).toBe(false);
  } finally {
    await server.close(); store.close();
    rmSync(hostRoot, { recursive: true, force: true });
    rmSync(guestRoot, { recursive: true, force: true });
  }
});
