// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TeamMemberOverview, TeamMemberRoleControl, memberMonogram, sortTeamMembers } from '../../src/renderer/components/TeamWorkspaceView';
import type { HostedTeamWorkspace } from '../../src/main/team-local-service';

const hosted: HostedTeamWorkspace = {
  workspaceId: 'workspace', name: 'Synthetic team', projectId: 'project', coordinatorUrl: 'http://127.0.0.1:5000',
  defaultMemberAccess: 'none', members: [
    { id: 'owner', workspaceId: 'workspace', displayName: 'Alex Morgan', role: 'owner', roleRevision: 0, revokedAt: null, projectAccess: null, extraCapabilities: [] },
    { id: 'editor', workspaceId: 'workspace', displayName: 'Jo', role: 'editor', roleRevision: 0, revokedAt: null, projectAccess: 'edit', extraCapabilities: ['manage_task'] },
    { id: 'revoked', workspaceId: 'workspace', displayName: 'Former member', role: 'viewer', roleRevision: 0, revokedAt: '2026-11-27T00:00:00Z', projectAccess: 'read', extraCapabilities: [] },
  ],
};

describe('team member overview', () => {
  it('lists actual non-revoked members and their effective project access', () => {
    const html = renderToStaticMarkup(<TeamMemberOverview hosted={hosted} currentMemberId="owner" />);
    expect(html).toContain('Alex Morgan');
    expect(html).toContain('Jo');
    expect(html).not.toContain('Former member');
    expect(html).toContain('Mitarbeiten');
    expect(html).toContain('Owner');
    expect(html).toContain('>Du<');
    expect(html).not.toContain('online');
  });

  it('shows the authenticated project roster to a guest without inventing online state', () => {
    const html = renderToStaticMarkup(<TeamMemberOverview hosted={null} currentMemberId="member" projectMembers={[
      { id: 'owner', displayName: 'Owner User', role: 'owner', roleRevision: 0, projectAccess: 'edit', canEditDraft: true, canManageTask: true, canStartAgent: true },
      { id: 'member', displayName: 'Guest User', role: 'developer', roleRevision: 0, projectAccess: 'edit', canEditDraft: true, canManageTask: false, canStartAgent: false },
    ]} />);
    expect(html).toContain('Guest User');
    expect(html).toContain('Owner User');
    expect(html).toContain('Entwürfe bearbeiten');
    expect(html).toContain('>Du<');
    expect(html).not.toContain('online');
    expect(html).not.toContain('0 Mitglieder');
    expect(memberMonogram('Alex Morgan')).toBe('AM');
    expect(memberMonogram('Jo')).toBe('JO');
  });

  it('does not silently show a stale roster when the coordinator becomes unavailable', () => {
    const html = renderToStaticMarkup(<TeamMemberOverview hosted={null} projectMembers={null} rosterError="Coordinator is unavailable." />);
    expect(html).toContain('Mitgliederliste nicht erreichbar');
    expect(html).not.toContain('Guest User');
  });

  it('does not describe a default viewer as able to work on the project', () => {
    const viewer = { id: 'viewer', workspaceId: 'workspace', displayName: 'Read Only', role: 'viewer' as const, roleRevision: 0,
      revokedAt: null, projectAccess: null, extraCapabilities: [] };
    const html = renderToStaticMarkup(<TeamMemberOverview hosted={{ ...hosted, defaultMemberAccess: 'edit', members: [viewer] }} />);
    expect(html).toContain('Read Only');
    expect(html).toContain('Nur lesen');
    expect(html).not.toContain('Mitarbeiten');
  });

  it('sorts real host members by role, name, or effective project access without changing the source list', async () => {
    const members: HostedTeamWorkspace['members'] = [
      { id: 'viewer', workspaceId: 'workspace', displayName: 'Mae', role: 'viewer', roleRevision: 0, revokedAt: null, projectAccess: 'read', extraCapabilities: [] },
      { id: 'owner', workspaceId: 'workspace', displayName: 'Zoe', role: 'owner', roleRevision: 0, revokedAt: null, projectAccess: null, extraCapabilities: [] },
      { id: 'developer', workspaceId: 'workspace', displayName: 'Bob', role: 'developer', roleRevision: 0, revokedAt: null, projectAccess: 'none', extraCapabilities: [] },
      { id: 'editor', workspaceId: 'workspace', displayName: 'Ada', role: 'editor', roleRevision: 0, revokedAt: null, projectAccess: 'edit', extraCapabilities: [] },
      { id: 'revoked', workspaceId: 'workspace', displayName: 'Former', role: 'admin', roleRevision: 0, revokedAt: '2026-11-27T00:00:00Z', projectAccess: 'edit', extraCapabilities: [] },
    ];
    const team = { ...hosted, members };
    expect(sortTeamMembers(members, 'access', team.defaultMemberAccess).map((member) => member.displayName)).toEqual(['Ada', 'Zoe', 'Mae', 'Bob']);
    expect(members[0]?.displayName).toBe('Mae');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const names = () => [...host.querySelectorAll('.team-member-identity strong')].map((element) => element.textContent);
    try {
      await act(async () => { root.render(<TeamMemberOverview hosted={team} currentMemberId="owner" />); });
      expect(names()).toEqual(['Zoe', 'Ada', 'Bob', 'Mae']);
      const select = host.querySelector<HTMLSelectElement>('select[aria-label="Mitglieder sortieren"]');
      expect(select).not.toBeNull();
      await act(async () => { select!.value = 'name'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(names()).toEqual(['Ada', 'Bob', 'Mae', 'Zoe']);
      await act(async () => { select!.value = 'access'; select!.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(names()).toEqual(['Ada', 'Zoe', 'Mae', 'Bob']);
      expect(host.textContent).not.toContain('Former');
      expect(host.textContent).not.toContain('online');
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('requires an explicit second click before the owner changes a member role', async () => {
    const previous = window.studio;
    const changeTeamMemberRole = vi.fn().mockResolvedValue({ memberId: 'editor', role: 'developer', revision: 1, repeated: false });
    Object.defineProperty(window, 'studio', { configurable: true, value: { changeTeamMemberRole } });
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const onSaved = vi.fn();
    try {
      await act(async () => { root.render(<TeamMemberRoleControl member={hosted.members[1]!} workspaceId="workspace" onSaved={onSaved} />); });
      const role = host.querySelector<HTMLSelectElement>('select');
      const action = host.querySelector<HTMLButtonElement>('button');
      expect(role).not.toBeNull(); expect(action).not.toBeNull();
      await act(async () => { role!.value = 'developer'; role!.dispatchEvent(new Event('change', { bubbles: true })); });
      await act(async () => { action!.click(); });
      expect(changeTeamMemberRole).not.toHaveBeenCalled();
      expect(action!.textContent).toContain('bestätigen');
      await act(async () => { action!.click(); });
      expect(changeTeamMemberRole).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', memberId: 'editor', role: 'developer', expectedRevision: 0 }));
      expect(onSaved).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { root.unmount(); }); host.remove();
      Object.defineProperty(window, 'studio', { configurable: true, value: previous });
    }
  });

  it('retries a lost role-change response with the original mutation ID', async () => {
    const previous = window.studio;
    const changeTeamMemberRole = vi.fn()
      .mockRejectedValueOnce(new Error('Coordinator is unavailable.'))
      .mockResolvedValueOnce({ memberId: 'editor', role: 'developer', revision: 1, repeated: true });
    Object.defineProperty(window, 'studio', { configurable: true, value: { changeTeamMemberRole } });
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => { root.render(<TeamMemberRoleControl member={hosted.members[1]!} workspaceId="workspace" onSaved={() => undefined} />); });
      const select = host.querySelector<HTMLSelectElement>('select')!;
      const action = host.querySelector<HTMLButtonElement>('button')!;
      await act(async () => { select.value = 'developer'; select.dispatchEvent(new Event('change', { bubbles: true })); });
      await act(async () => { action.click(); });
      await act(async () => { action.click(); });
      expect(host.textContent).toContain('Coordinator is unavailable.');
      await act(async () => { action.click(); });
      await act(async () => { action.click(); });
      expect(changeTeamMemberRole).toHaveBeenCalledTimes(2);
      expect(changeTeamMemberRole.mock.calls[1][0].mutationId).toBe(changeTeamMemberRole.mock.calls[0][0].mutationId);
    } finally {
      await act(async () => { root.unmount(); }); host.remove();
      Object.defineProperty(window, 'studio', { configurable: true, value: previous });
    }
  });
});
