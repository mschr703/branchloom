// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TeamWorkspaceSettings } from '../../src/renderer/components/TeamWorkspaceSettings';
import type { HostedTeamWorkspace } from '../../src/main/team-local-service';

const owner = { id: 'owner', workspaceId: 'workspace', displayName: 'Owner', role: 'owner' as const, revokedAt: null,
  projectAccess: null, extraCapabilities: [] };
const colleague = { id: 'colleague', workspaceId: 'workspace', displayName: 'Colleague', role: 'editor' as const, revokedAt: null,
  projectAccess: null, extraCapabilities: [] };
const workspace: HostedTeamWorkspace = { workspaceId: 'workspace', projectId: 'project', name: 'Sample team',
  coordinatorUrl: 'http://127.0.0.1:4567', defaultMemberAccess: 'edit', members: [owner] };

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('creates a local workspace, exposes an invitation once, and requires a second click to revoke', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const create = vi.fn().mockResolvedValue(workspace);
  const invite = vi.fn().mockResolvedValue({ coordinatorUrl: workspace.coordinatorUrl, inviteSecret: 'synthetic-invite',
    expiresAt: '2026-11-27T12:00:00.000Z' });
  const revoke = vi.fn().mockResolvedValue({ ...workspace, members: [owner, { ...colleague, revokedAt: '2026-11-26T12:00:00.000Z' }] });
  const setProjectAccess = vi.fn().mockResolvedValue({ ...workspace, members: [owner, { ...colleague, projectAccess: 'read' }] });
  const setCapabilityGrant = vi.fn().mockResolvedValue({ ...workspace, members: [owner,
    { ...colleague, projectAccess: 'read', extraCapabilities: ['manage_task'] }] });
  let hosted: HostedTeamWorkspace | null = null;
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    hostedTeamProject: vi.fn().mockImplementation(async () => hosted), teamConnections: vi.fn().mockResolvedValue([]),
    ownedTeamWorkspaces: vi.fn().mockResolvedValue([]),
    pendingTeamJoin: vi.fn().mockResolvedValue(null), createLocalTeamWorkspace: create,
    inviteTeamMember: invite, revokeTeamMember: revoke,
    teamTailnetStatus: vi.fn().mockResolvedValue({ enabled: false, coordinatorUrl: null }),
    enableTeamTailnet: vi.fn().mockResolvedValue({ enabled: true, coordinatorUrl: 'http://100.73.95.17:4567' }),
    disableTeamTailnet: vi.fn().mockResolvedValue({ enabled: false, coordinatorUrl: null }),
    setTeamProjectAccess: setProjectAccess, setTeamCapabilityGrant: setCapabilityGrant,
  } });
  try {
    await act(async () => { root.render(<TeamWorkspaceSettings key="first" projectId="project" />); });
    expect(create).not.toHaveBeenCalled();
    const inputs = host.querySelectorAll<HTMLInputElement>('.team-workspace-form input');
    await act(async () => { setInput(inputs[0]!, 'Sample team'); setInput(inputs[1]!, 'Owner'); });
    await act(async () => { host.querySelector<HTMLFormElement>('.team-workspace-form')!.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })); });
    expect(create).toHaveBeenCalledWith({ projectId: 'project', workspaceName: 'Sample team', ownerName: 'Owner' });
    expect(host.textContent).toContain('1 Mitglieder');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Einladung erstellen')!.click(); });
    expect(invite).toHaveBeenCalledWith({ projectId: 'project', role: 'editor', transport: 'local' });
    expect(host.querySelectorAll<HTMLInputElement>('.team-workspace-invitation input')[1]?.value).toBe('synthetic-invite');
    hosted = { ...workspace, members: [owner, colleague] };
    await act(async () => { root.render(<TeamWorkspaceSettings key="second" projectId="project" />); });
    expect(host.textContent).not.toContain('synthetic-invite');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Tailscale-Zugang aktivieren')!.click(); });
    expect(window.studio.enableTeamTailnet).toHaveBeenCalledWith('project');
    expect(host.textContent).toContain('100.73.95.17');
    await act(async () => {
      const transport = host.querySelectorAll<HTMLSelectElement>('.team-workspace-invite select')[1]!;
      transport.value = 'tailnet'; transport.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Einladung erstellen')!.click(); });
    expect(invite).toHaveBeenLastCalledWith({ projectId: 'project', role: 'editor', transport: 'tailnet' });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Tailscale-Zugang beenden')!.click(); });
    expect(window.studio.disableTeamTailnet).toHaveBeenCalledWith('project');
    const rights = host.querySelector<HTMLDetailsElement>('.team-workspace-member-rights')!;
    await act(async () => { rights.open = true; });
    await act(async () => {
      const access = rights.querySelector<HTMLSelectElement>('select')!;
      access.value = 'read';
      access.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setProjectAccess).toHaveBeenCalledWith({ projectId: 'project', memberId: 'colleague', access: 'read' });
    expect(rights.textContent).toContain('erst bei vollem Projektzugang');
    await act(async () => { [...rights.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Aufgabensteuerung erlauben')!.click(); });
    expect(setCapabilityGrant).not.toHaveBeenCalled();
    await act(async () => { [...rights.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Aufgabensteuerung bestätigen')!.click(); });
    expect(setCapabilityGrant).toHaveBeenCalledWith({ projectId: 'project', memberId: 'colleague',
      capability: 'manage_task', grant: true });
    await act(async () => { [...rights.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Agentenstart erlauben')!.click(); });
    expect(setCapabilityGrant).toHaveBeenCalledTimes(1);
    await act(async () => { [...rights.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Agentenstart bestätigen')!.click(); });
    expect(setCapabilityGrant).toHaveBeenCalledWith({ projectId: 'project', memberId: 'colleague',
      capability: 'start_agent', grant: true });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Zugriff widerrufen')!.click(); });
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Widerruf bestätigen')!.click(); });
    expect(revoke).toHaveBeenCalledWith({ projectId: 'project', memberId: 'colleague' });
    expect(host.textContent).not.toContain('Colleague');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});

it('joins from the visible member form without a local project and reports the saved connection', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const connection = { workspaceId: 'workspace', memberId: 'member', displayName: 'Guest', role: 'editor' as const,
    coordinatorUrl: 'http://127.0.0.1:4567' };
  const join = vi.fn().mockResolvedValue(connection);
  const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([connection]);
  const changed = vi.fn();
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    teamConnections: list, pendingTeamJoin: vi.fn().mockResolvedValue(null), joinTeam: join,
    ownedTeamWorkspaces: vi.fn().mockResolvedValue([]),
  } });
  try {
    await act(async () => { root.render(<TeamWorkspaceSettings onConnectionChange={changed} />); });
    const form = host.querySelector<HTMLFormElement>('.team-workspace-join form')!;
    const inputs = form.querySelectorAll<HTMLInputElement>('input');
    await act(async () => {
      setInput(inputs[0]!, connection.coordinatorUrl);
      setInput(inputs[1]!, 'synthetic-invite');
      setInput(inputs[2]!, 'Guest');
    });
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(join).toHaveBeenCalledWith({ coordinatorUrl: connection.coordinatorUrl,
      inviteSecret: 'synthetic-invite', displayName: 'Guest' });
    expect(changed).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('gemeinsamen Kartenentwurf öffnen');
    expect(host.textContent).toContain('Gespeicherte Teamzugänge: 1');
    expect(inputs[1]?.value).toBe('');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});

it('adds a second project only after an explicit confirmation and shows its private default', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const added: HostedTeamWorkspace = { ...workspace, projectId: 'second-project', defaultMemberAccess: 'none',
    members: [owner, { ...colleague, projectAccess: null }] };
  const add = vi.fn().mockResolvedValue(added);
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    hostedTeamProject: vi.fn().mockResolvedValue(null), teamConnections: vi.fn().mockResolvedValue([]),
    pendingTeamJoin: vi.fn().mockResolvedValue(null), ownedTeamWorkspaces: vi.fn().mockResolvedValue([
      { workspaceId: 'workspace', name: 'Sample team', projectCount: 1, memberCount: 2 }]),
    addProjectToTeamWorkspace: add,
  } });
  try {
    await act(async () => { root.render(<TeamWorkspaceSettings projectId="second-project" />); });
    expect(host.textContent).toContain('Bestehende und spätere Mitglieder');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Projekt hinzufügen')!.click(); });
    expect(add).not.toHaveBeenCalled();
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'Projekt hinzufügen bestätigen')!.click(); });
    expect(add).toHaveBeenCalledWith({ projectId: 'second-project', workspaceId: 'workspace' });
    expect(host.textContent).toContain('Projektstandard: kein Zugang');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});
