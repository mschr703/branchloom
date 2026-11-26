import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { acceptTeamMemberInvite, addTeamProject, authenticateTeamMember, createTeamMemberInvite, createTeamWorkspace,
  requireTeamProjectCapability, revokeTeamMember, revokeTeamMemberInvite, setTeamCardPriority,
  setTeamProjectAccess } from '../../src/main/team-workspace';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-workspace-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic project', path: root });
  return { store, project, file, root };
}

it('persists distinct member identities and rejects project actions after revocation', () => {
  const f = fixture();
  const created = createTeamWorkspace(f.store.db, { workspaceName: 'Sample team', projectId: f.project.id, ownerName: 'Owner' });
  const invite = createTeamMemberInvite(f.store.db, created.credential, created.workspaceId, 'editor');
  const joined = acceptTeamMemberInvite(f.store.db, invite.secret, 'Colleague');
  try {
    expect(joined.member.id).not.toBe(created.owner.id);
    expect(joined.credential).not.toBe(created.credential);
    expect(requireTeamProjectCapability(f.store.db, joined.credential, f.project.id, 'read').id).toBe(joined.member.id);
    expect(requireTeamProjectCapability(f.store.db, joined.credential, f.project.id, 'edit').id).toBe(joined.member.id);
    expect(() => requireTeamProjectCapability(f.store.db, joined.credential, f.project.id, 'start_agent')).toThrow('not permitted');
    expect(() => requireTeamProjectCapability(f.store.db, joined.credential, f.project.id, 'integrate')).toThrow('not permitted');
    expect(() => createTeamMemberInvite(f.store.db, joined.credential, created.workspaceId, 'viewer')).toThrow('cannot invite');
    expect(f.store.db.prepare('SELECT credential_hash FROM team_members WHERE id = ?').get(joined.member.id)).not.toEqual({ credential_hash: joined.credential });
    expect(f.store.db.prepare('SELECT secret_hash FROM team_member_invites WHERE id = ?').get(invite.inviteId)).not.toEqual({ secret_hash: invite.secret });
    expect(() => acceptTeamMemberInvite(f.store.db, invite.secret, 'Another')).toThrow('unavailable');
  } finally { f.store.close(); }

  const reopened = new StudioStore(f.file);
  try {
    expect(authenticateTeamMember(reopened.db, joined.credential).id).toBe(joined.member.id);
    revokeTeamMember(reopened.db, created.credential, joined.member.id);
    expect(() => authenticateTeamMember(reopened.db, joined.credential)).toThrow('unavailable');
    expect(() => requireTeamProjectCapability(reopened.db, joined.credential, f.project.id, 'read')).toThrow('unavailable');
    expect(() => revokeTeamMember(reopened.db, created.credential, created.owner.id)).toThrow('cannot be removed');
  } finally { reopened.close(); }
});

it('keeps invitations and project rights scoped to one workspace', () => {
  const f = fixture();
  try {
    const otherPath = join(f.root, 'other');
    mkdirSync(otherPath);
    const second = f.store.createProject({ name: 'Another project', path: otherPath });
    const owner = createTeamWorkspace(f.store.db, { workspaceName: 'One team', projectId: f.project.id, ownerName: 'Owner' });
    const other = createTeamWorkspace(f.store.db, { workspaceName: 'Other team', projectId: second.id, ownerName: 'Second owner' });
    const invite = createTeamMemberInvite(f.store.db, owner.credential, owner.workspaceId, 'viewer');
    const viewer = acceptTeamMemberInvite(f.store.db, invite.secret, 'Viewer');
    expect(requireTeamProjectCapability(f.store.db, viewer.credential, f.project.id, 'read').role).toBe('viewer');
    expect(() => requireTeamProjectCapability(f.store.db, viewer.credential, f.project.id, 'edit')).toThrow('not permitted');
    expect(() => requireTeamProjectCapability(f.store.db, viewer.credential, second.id, 'read')).toThrow('not permitted');
    expect(() => createTeamMemberInvite(f.store.db, other.credential, owner.workspaceId, 'viewer')).toThrow('cannot invite');
    expect(() => createTeamWorkspace(f.store.db, { workspaceName: 'Duplicate', projectId: f.project.id, ownerName: 'Duplicate' })).toThrow();
    expect((f.store.db.prepare('SELECT COUNT(*) AS count FROM team_workspaces').get() as { count: number }).count).toBe(2);
  } finally { f.store.close(); }
});

it('expires and revokes invitation secrets without creating members', () => {
  const f = fixture();
  try {
    const owner = createTeamWorkspace(f.store.db, { workspaceName: 'Sample team', projectId: f.project.id, ownerName: 'Owner' });
    const expired = createTeamMemberInvite(f.store.db, owner.credential, owner.workspaceId, 'editor');
    f.store.db.prepare('UPDATE team_member_invites SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', expired.inviteId);
    expect(() => acceptTeamMemberInvite(f.store.db, expired.secret, 'Late member')).toThrow('unavailable');
    const revoked = createTeamMemberInvite(f.store.db, owner.credential, owner.workspaceId, 'viewer');
    revokeTeamMemberInvite(f.store.db, owner.credential, revoked.inviteId);
    expect(() => acceptTeamMemberInvite(f.store.db, revoked.secret, 'Revoked member')).toThrow('unavailable');
    expect(() => revokeTeamMemberInvite(f.store.db, owner.credential, revoked.inviteId)).toThrow('unavailable');
    expect((f.store.db.prepare('SELECT COUNT(*) AS count FROM team_members').get() as { count: number }).count).toBe(1);
  } finally { f.store.close(); }
});

it('serializes card metadata commands from two clients and keeps retries idempotent', () => {
  const f = fixture();
  const column = f.store.snapshot(f.project.id).columns[0];
  const card = f.store.createCard({ projectId: f.project.id, columnId: column.id, title: 'Synthetic task' });
  const owner = createTeamWorkspace(f.store.db, { workspaceName: 'Sample team', projectId: f.project.id, ownerName: 'Owner' });
  const invite = createTeamMemberInvite(f.store.db, owner.credential, owner.workspaceId, 'editor');
  const colleague = acceptTeamMemberInvite(f.store.db, invite.secret, 'Colleague');
  const secondClient = new StudioStore(f.file);
  const firstMutation = randomUUID();
  const secondMutation = randomUUID();
  try {
    const first = setTeamCardPriority(f.store, { credential: owner.credential, projectId: f.project.id,
      cardId: card.id, priority: 'high', expectedRevision: 0, mutationId: firstMutation });
    expect(first).toMatchObject({ revision: 1, priority: 'high', repeated: false });
    expect(() => setTeamCardPriority(secondClient, { credential: colleague.credential, projectId: f.project.id,
      cardId: card.id, priority: 'urgent', expectedRevision: 0, mutationId: secondMutation })).toThrow('Card changed');
    expect(setTeamCardPriority(secondClient, { credential: owner.credential, projectId: f.project.id,
      cardId: card.id, priority: 'high', expectedRevision: 0, mutationId: firstMutation }))
      .toMatchObject({ revision: 1, priority: 'high', repeated: true });
    expect(() => setTeamCardPriority(secondClient, { credential: owner.credential, projectId: f.project.id,
      cardId: card.id, priority: 'urgent', expectedRevision: 0, mutationId: firstMutation })).toThrow('Mutation ID');
    const second = setTeamCardPriority(secondClient, { credential: colleague.credential, projectId: f.project.id,
      cardId: card.id, priority: 'urgent', expectedRevision: 1, mutationId: secondMutation });
    expect(second).toMatchObject({ revision: 2, priority: 'urgent', repeated: false });
    expect(f.store.card(card.id).priority).toBe('urgent');
    revokeTeamMember(f.store.db, owner.credential, colleague.member.id);
    expect(() => setTeamCardPriority(secondClient, { credential: colleague.credential, projectId: f.project.id,
      cardId: card.id, priority: 'low', expectedRevision: 2, mutationId: randomUUID() })).toThrow('unavailable');
  } finally { secondClient.close(); f.store.close(); }
  const restarted = new StudioStore(f.file);
  try {
    expect(setTeamCardPriority(restarted, { credential: owner.credential, projectId: f.project.id,
      cardId: card.id, priority: 'high', expectedRevision: 0, mutationId: firstMutation }))
      .toMatchObject({ revision: 1, repeated: true });
    expect(restarted.card(card.id).priority).toBe('urgent');
  } finally { restarted.close(); }
});

it('links several projects to a workspace and only narrows inherited project rights', () => {
  const f = fixture();
  try {
    const otherPath = join(f.root, 'second');
    mkdirSync(otherPath);
    const second = f.store.createProject({ name: 'Second project', path: otherPath });
    const owner = createTeamWorkspace(f.store.db, { workspaceName: 'Sample team', projectId: f.project.id, ownerName: 'Owner' });
    const editor = acceptTeamMemberInvite(f.store.db,
      createTeamMemberInvite(f.store.db, owner.credential, owner.workspaceId, 'editor').secret, 'Editor');
    const viewer = acceptTeamMemberInvite(f.store.db,
      createTeamMemberInvite(f.store.db, owner.credential, owner.workspaceId, 'viewer').secret, 'Viewer');
    expect(() => requireTeamProjectCapability(f.store.db, editor.credential, second.id, 'read')).toThrow('not permitted');
    expect(() => addTeamProject(f.store.db, editor.credential, second.id)).toThrow('Only a team owner');
    addTeamProject(f.store.db, owner.credential, second.id);
    expect(requireTeamProjectCapability(f.store.db, editor.credential, second.id, 'edit').id).toBe(editor.member.id);
    setTeamProjectAccess(f.store.db, owner.credential, second.id, editor.member.id, 'read');
    expect(requireTeamProjectCapability(f.store.db, editor.credential, second.id, 'read').id).toBe(editor.member.id);
    expect(() => requireTeamProjectCapability(f.store.db, editor.credential, second.id, 'edit')).toThrow('not permitted');
    setTeamProjectAccess(f.store.db, owner.credential, second.id, editor.member.id, 'none');
    expect(() => requireTeamProjectCapability(f.store.db, editor.credential, second.id, 'read')).toThrow('not permitted');
    expect(requireTeamProjectCapability(f.store.db, editor.credential, f.project.id, 'edit').id).toBe(editor.member.id);
    expect(() => setTeamProjectAccess(f.store.db, editor.credential, second.id, viewer.member.id, 'none')).toThrow();
    expect(() => setTeamProjectAccess(f.store.db, owner.credential, second.id, viewer.member.id, 'edit')).toThrow('cannot exceed');
    setTeamProjectAccess(f.store.db, owner.credential, second.id, editor.member.id, null);
    expect(requireTeamProjectCapability(f.store.db, editor.credential, second.id, 'edit').id).toBe(editor.member.id);
  } finally { f.store.close(); }
});
