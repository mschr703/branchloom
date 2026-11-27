// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TeamMemberOverview, memberMonogram, sortTeamMembers } from '../../src/renderer/components/TeamWorkspaceView';
import type { HostedTeamWorkspace } from '../../src/main/team-local-service';

const hosted: HostedTeamWorkspace = {
  workspaceId: 'workspace', name: 'Synthetic team', projectId: 'project', coordinatorUrl: 'http://127.0.0.1:5000',
  defaultMemberAccess: 'none', members: [
    { id: 'owner', workspaceId: 'workspace', displayName: 'Alex Morgan', role: 'owner', revokedAt: null, projectAccess: null, extraCapabilities: [] },
    { id: 'editor', workspaceId: 'workspace', displayName: 'Jo', role: 'editor', revokedAt: null, projectAccess: 'edit', extraCapabilities: ['manage_task'] },
    { id: 'revoked', workspaceId: 'workspace', displayName: 'Former member', role: 'viewer', revokedAt: '2026-11-27T00:00:00Z', projectAccess: 'read', extraCapabilities: [] },
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

  it('shows only the authenticated self when a guest cannot read the owner roster', () => {
    const html = renderToStaticMarkup(<TeamMemberOverview hosted={null} fallbackMember={{ displayName: 'Guest User', role: 'developer' }} />);
    expect(html).toContain('Guest User');
    expect(html).toContain('Entwicklung · Du');
    expect(html).toContain('nur auf dem Host sichtbar');
    expect(html).not.toContain('0 Mitglieder');
    expect(memberMonogram('Alex Morgan')).toBe('AM');
    expect(memberMonogram('Jo')).toBe('JO');
  });

  it('does not describe a default viewer as able to work on the project', () => {
    const viewer = { id: 'viewer', workspaceId: 'workspace', displayName: 'Read Only', role: 'viewer' as const,
      revokedAt: null, projectAccess: null, extraCapabilities: [] };
    const html = renderToStaticMarkup(<TeamMemberOverview hosted={{ ...hosted, defaultMemberAccess: 'edit', members: [viewer] }} />);
    expect(html).toContain('Read Only');
    expect(html).toContain('Nur lesen');
    expect(html).not.toContain('Mitarbeiten');
  });

  it('sorts real host members by role, name, or effective project access without changing the source list', async () => {
    const members: HostedTeamWorkspace['members'] = [
      { id: 'viewer', workspaceId: 'workspace', displayName: 'Mae', role: 'viewer', revokedAt: null, projectAccess: 'read', extraCapabilities: [] },
      { id: 'owner', workspaceId: 'workspace', displayName: 'Zoe', role: 'owner', revokedAt: null, projectAccess: null, extraCapabilities: [] },
      { id: 'developer', workspaceId: 'workspace', displayName: 'Bob', role: 'developer', revokedAt: null, projectAccess: 'none', extraCapabilities: [] },
      { id: 'editor', workspaceId: 'workspace', displayName: 'Ada', role: 'editor', revokedAt: null, projectAccess: 'edit', extraCapabilities: [] },
      { id: 'revoked', workspaceId: 'workspace', displayName: 'Former', role: 'admin', revokedAt: '2026-11-27T00:00:00Z', projectAccess: 'edit', extraCapabilities: [] },
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
});
