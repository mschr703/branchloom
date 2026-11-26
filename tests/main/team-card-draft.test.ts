import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyTeamCardDraftUpdate, readTeamCardDraft } from '../../src/main/team-card-draft';
import { acceptTeamMemberInvite, createTeamMemberInvite, createTeamWorkspace, revokeTeamMember } from '../../src/main/team-workspace';
import { StudioStore } from '../../src/main/store';

it('merges concurrent member text without changing the authoritative card and survives restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-draft-'));
  let store = new StudioStore(join(root, 'studio.sqlite'));
  try {
    const project = store.createProject({ name: 'Sample', path: root });
    mkdirSync(join(root, 'other'));
    const other = store.createProject({ name: 'Other', path: join(root, 'other') });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
      title: 'Plan sign-in', description: 'Accepted work stays separate' });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Team', projectId: project.id, ownerName: 'Owner' });
    const invite = createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'editor');
    const editor = acceptTeamMemberInvite(store.db, invite.secret, 'Colleague');
    const viewerInvite = createTeamMemberInvite(store.db, owner.credential, owner.workspaceId, 'viewer');
    const viewer = acceptTeamMemberInvite(store.db, viewerInvite.secret, 'Observer');
    const left = new Y.Doc(); const right = new Y.Doc();
    left.getText('body').insert(0, 'Review copy. ');
    right.getText('body').insert(0, 'Check errors. ');
    const firstUpdate = Buffer.from(Y.encodeStateAsUpdate(left)).toString('base64');
    const secondUpdate = Buffer.from(Y.encodeStateAsUpdate(right)).toString('base64');
    const firstId = randomUUID();
    expect(applyTeamCardDraftUpdate(store.db, { credential: owner.credential, projectId: project.id,
      cardId: card.id, mutationId: firstId, update: firstUpdate }).revision).toBe(1);
    expect(applyTeamCardDraftUpdate(store.db, { credential: editor.credential, projectId: project.id,
      cardId: card.id, mutationId: randomUUID(), update: secondUpdate }).revision).toBe(2);
    const repeat = applyTeamCardDraftUpdate(store.db, { credential: owner.credential, projectId: project.id,
      cardId: card.id, mutationId: firstId, update: firstUpdate });
    expect(repeat.repeated).toBe(true);
    expect(repeat.revision).toBe(2);
    const merged = new Y.Doc();
    Y.applyUpdate(merged, Buffer.from(readTeamCardDraft(store.db, { credential: editor.credential,
      projectId: project.id, cardId: card.id }).update, 'base64'));
    expect(merged.getText('body').toString()).toContain('Review copy.');
    expect(merged.getText('body').toString()).toContain('Check errors.');
    expect(store.snapshot(project.id).cards.find((item) => item.id === card.id)?.description).toBe('Accepted work stays separate');
    expect(() => applyTeamCardDraftUpdate(store.db, { credential: viewer.credential, projectId: project.id,
      cardId: card.id, mutationId: randomUUID(), update: firstUpdate })).toThrow('not permitted');
    expect(() => readTeamCardDraft(store.db, { credential: editor.credential, projectId: other.id, cardId: card.id }))
      .toThrow('not permitted');
    expect(() => applyTeamCardDraftUpdate(store.db, { credential: owner.credential, projectId: project.id,
      cardId: card.id, mutationId: firstId, update: secondUpdate })).toThrow('already used');
    expect(() => applyTeamCardDraftUpdate(store.db, { credential: owner.credential, projectId: project.id,
      cardId: card.id, mutationId: randomUUID(), update: 'not-base64' })).toThrow('Invalid');
    revokeTeamMember(store.db, owner.credential, editor.member.id);
    expect(() => readTeamCardDraft(store.db, { credential: editor.credential, projectId: project.id, cardId: card.id }))
      .toThrow('credential');
    store.close();
    store = new StudioStore(join(root, 'studio.sqlite'));
    expect(readTeamCardDraft(store.db, { credential: owner.credential, projectId: project.id, cardId: card.id }).revision).toBe(2);
    left.destroy(); right.destroy(); merged.destroy();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
