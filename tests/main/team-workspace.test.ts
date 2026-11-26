import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { acceptTeamMemberInvite, authenticateTeamMember, createTeamMemberInvite, createTeamWorkspace,
  requireTeamProjectCapability, revokeTeamMember, revokeTeamMemberInvite } from '../../src/main/team-workspace';

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
