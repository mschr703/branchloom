import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { StudioStore } from '../../src/main/store';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { claimTeamMemberInvite, createTeamMemberInvite, createTeamWorkspace, revokeTeamMember } from '../../src/main/team-workspace';

function eventReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let buffered = '';
  return async (name: string): Promise<Record<string, unknown>> => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const boundary = buffered.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        if (event !== name) continue;
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (!data) throw new Error('Event had no data.');
        return JSON.parse(data) as Record<string, unknown>;
      }
      const item = await reader.read();
      if (item.done) throw new Error(`Event stream ended before ${name}.`);
      buffered += new TextDecoder().decode(item.value);
    }
    throw new Error(`Timed out waiting for ${name}.`);
  };
}

it('pushes authenticated draft and presence events and ends a revoked member stream', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-events-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const coordinator = new TeamCoordinatorHttp(store);
  const controllers = [new AbortController(), new AbortController()];
  try {
    const project = store.createProject({ name: 'Synthetic team', path: root });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
      title: 'Plan together', description: 'Accepted version' });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Team', projectId: project.id, ownerName: 'Owner' });
    const invite = createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'editor');
    const colleagueCredential = randomBytes(32).toString('base64url');
    const colleague = claimTeamMemberInvite(store.db, { inviteSecret: invite.secret, displayName: 'Colleague',
      credential: colleagueCredential, requestId: randomUUID() });
    const base = await coordinator.start();
    const eventsUrl = `${base}/v1/projects/${project.id}/cards/${card.id}/draft/events`;
    const connect = (credential: string, index: number) => fetch(eventsUrl, {
      headers: { Authorization: `Bearer ${credential}` }, signal: controllers[index]!.signal,
    });
    expect((await fetch(eventsUrl, { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } })).status).toBe(401);
    const first = await connect(owner.credential, 0);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toContain('text/event-stream');
    const firstReader = first.body!.getReader();
    const nextFirst = eventReader(firstReader);
    expect((await nextFirst('presence')).members).toEqual([{ memberId: owner.owner.id, displayName: 'Owner' }]);
    const second = await connect(colleagueCredential, 1);
    const secondReader = second.body!.getReader();
    const nextSecond = eventReader(secondReader);
    const twoMembers = (await nextFirst('presence')).members;
    expect(twoMembers).toEqual(expect.arrayContaining([
      { memberId: owner.owner.id, displayName: 'Owner' },
      { memberId: colleague.id, displayName: 'Colleague' },
    ]));
    expect((await nextSecond('presence')).members).toEqual(twoMembers);
    const draft = new Y.Doc();
    draft.getText('body').insert(0, 'Discuss the first release.');
    const update = Buffer.from(Y.encodeStateAsUpdate(draft)).toString('base64');
    const changed = await fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/draft`, {
      method: 'POST', headers: { Authorization: `Bearer ${colleagueCredential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutationId: randomUUID(), update }),
    });
    expect(changed.status).toBe(200);
    expect((await nextFirst('draft')).revision).toBe(1);
    expect((await nextSecond('draft')).revision).toBe(1);
    expect(store.snapshot(project.id).cards.find((item) => item.id === card.id)?.description).toBe('Accepted version');
    const priority = await fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/priority`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner.credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutationId: randomUUID(), expectedRevision: 0, priority: 'high' }),
    });
    expect(priority.status).toBe(200);
    expect((await nextSecond('card')).revision).toBe(1);
    const columnId = store.snapshot(project.id).columns[1]!.id;
    const moved = await fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/column`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner.credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mutationId: randomUUID(), expectedRevision: 1, columnId }),
    });
    expect(moved.status).toBe(200);
    expect((await nextSecond('card')).revision).toBe(2);
    expect(store.card(card.id).columnId).toBe(columnId);
    revokeTeamMember(store.db, owner.credential, colleague.id);
    // A periodic authorization check closes an already-open stream after revocation.
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    await expect(secondReader.read()).resolves.toMatchObject({ done: true });
    expect((await nextFirst('presence')).members).toEqual([{ memberId: owner.owner.id, displayName: 'Owner' }]);
    draft.destroy();
  } finally {
    controllers.forEach((controller) => controller.abort());
    await coordinator.close(); store.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
