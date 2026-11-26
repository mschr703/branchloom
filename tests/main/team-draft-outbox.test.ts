import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { TeamConnectionStore } from '../../src/main/team-connection-store';
import { TeamDraftOutboxStore } from '../../src/main/team-draft-outbox';
import { TeamJoinAttemptStore } from '../../src/main/team-join-attempt';
import { TeamLocalService } from '../../src/main/team-local-service';
import { TeamRemoteClient } from '../../src/main/team-remote-client';
import { StudioStore } from '../../src/main/store';

const secure = {
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`sealed:${[...value].reverse().join('')}`),
  decryptStringAsync: async (value: Buffer) => ({ result: [...value.toString().slice(7)].reverse().join(''), shouldReEncrypt: false }),
};

it('replays a draft update after a lost response and client restart without duplicating it', async () => {
  const hostRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-outbox-host-'));
  const guestRoot = mkdtempSync(join(tmpdir(), 'branchloom-team-outbox-guest-'));
  const store = new StudioStore(join(hostRoot, 'studio.sqlite'));
  const host = new TeamLocalService(store, new TeamConnectionStore(hostRoot, secure));
  try {
    const project = store.createProject({ name: 'Shared project', path: hostRoot });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
      title: 'Shared draft' });
    const workspace = await host.create({ projectId: project.id, workspaceName: 'Team', ownerName: 'Owner' });
    const invitation = await host.invite(project.id, 'editor');
    const connections = new TeamConnectionStore(guestRoot, secure);
    const attempts = new TeamJoinAttemptStore(guestRoot, secure);
    const outbox = new TeamDraftOutboxStore(guestRoot, secure);
    const first = new TeamRemoteClient(connections, attempts, fetch, outbox);
    await first.beginJoin({ coordinatorUrl: invitation.coordinatorUrl,
      inviteSecret: invitation.inviteSecret, displayName: 'Alex' });
    const document = new Y.Doc();
    document.getText('body').insert(0, 'Retain this after a lost reply.');
    const update = Buffer.from(Y.encodeStateAsUpdate(document)).toString('base64');
    const mutationId = randomUUID();
    let dropped = false;
    const unreliable: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (!dropped && String(input).endsWith('/draft') && init?.method === 'POST') {
        dropped = true; await response.arrayBuffer(); throw new Error('Response lost after server commit');
      }
      return response;
    };
    const interrupted = new TeamRemoteClient(connections, attempts, unreliable, outbox);
    await expect(interrupted.updateCardDraft({ workspaceId: workspace.workspaceId, projectId: project.id,
      cardId: card.id, mutationId, update })).rejects.toThrow('unavailable');
    expect((await outbox.list()).map((item) => item.mutationId)).toEqual([mutationId]);
    expect(readFileSync(join(guestRoot, 'team-draft-outbox.bin')).toString()).not.toContain('Retain this');
    expect(readFileSync(join(guestRoot, 'team-draft-outbox.bin')).toString()).not.toContain(update);
    const resumed = new TeamRemoteClient(new TeamConnectionStore(guestRoot, secure),
      new TeamJoinAttemptStore(guestRoot, secure), fetch, new TeamDraftOutboxStore(guestRoot, secure));
    expect(await resumed.resumeCardDraftUpdates({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id })).toBe(1);
    expect((await resumed.cardDraft({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id })).revision).toBe(1);
    expect(await resumed.pendingCardDraftUpdates({ workspaceId: workspace.workspaceId, projectId: project.id, cardId: card.id })).toEqual([]);
    document.destroy();
  } finally {
    await host.close(); store.close();
    rmSync(hostRoot, { recursive: true, force: true });
    rmSync(guestRoot, { recursive: true, force: true });
  }
});
