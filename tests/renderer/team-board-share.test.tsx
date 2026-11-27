// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TeamBoardShare } from '../../src/renderer/components/TeamBoardShare';
import type { TeamBoardInvite } from '../../src/shared/team-board';

it('creates a read-only project link only on click and revokes that invitation', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const invite: TeamBoardInvite = { id: 'invite', projectId: 'project', displayName: 'Alex', role: 'viewer',
    canComment: false, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), revokedAt: null };
  let invites: TeamBoardInvite[] = [];
  const create = vi.fn().mockImplementation(async () => { invites = [invite];
    return { invite, secret: 'secret', url: 'http://100.101.102.103:4567/board/secret' }; });
  const copy = vi.fn().mockResolvedValue(undefined);
  const revoke = vi.fn().mockImplementation(async () => ({ ...invite, revokedAt: '2026-11-26T08:01:00.000Z' }));
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    teamBoardInvites: vi.fn().mockImplementation(async () => invites), teamBoardComments: vi.fn().mockResolvedValue([]), createTeamBoardInvite: create,
    copyTeamBoardInvite: copy, openTeamBoardInvite: vi.fn().mockResolvedValue(undefined), revokeTeamBoardInvite: revoke,
  } });
  try {
    await act(async () => { root.render(<TeamBoardShare projectId="project" />); });
    expect(create).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Karten ändern und Agenten starten kann er nicht.');
    const input = host.querySelector<HTMLInputElement>('.team-board-share-controls input')!;
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setInput.call(input, 'Alex'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'Tailscale-Link erstellen')!.click(); });
    expect(create).toHaveBeenCalledWith({ projectId: 'project', displayName: 'Alex', transport: 'tailnet', canComment: false });
    expect(host.querySelector<HTMLInputElement>('.team-board-share-link input')?.value).toBe('http://100.101.102.103:4567/board/secret');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'Link kopieren')!.click(); });
    expect(copy).toHaveBeenCalledWith({ secret: 'secret', transport: 'tailnet' });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'Widerrufen')!.click(); });
    expect(revoke).toHaveBeenCalledWith({ projectId: 'project', inviteId: 'invite' });
    expect(host.querySelector('.team-board-share-link')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});

it('requires an explicit comment permission and shows guest feedback only in the host panel', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const invite: TeamBoardInvite = { id: 'commenter', projectId: 'project', displayName: 'Sam', role: 'viewer',
    canComment: true, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), revokedAt: null };
  const create = vi.fn().mockResolvedValue({ invite, secret: 'secret', url: 'http://127.0.0.1:4567/board/secret' });
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    teamBoardInvites: vi.fn().mockResolvedValue([invite]), teamBoardComments: vi.fn().mockResolvedValue([{
      id: 'comment', projectId: 'project', cardId: 'card', cardTitle: 'Settings page', inviteId: invite.id,
      displayName: 'Sam', body: 'Please check the empty state.', createdAt: '2026-11-26T08:00:00.000Z',
    }]), createTeamBoardInvite: create,
  } });
  try {
    await act(async () => { root.render(<TeamBoardShare projectId="project" />); });
    expect(host.textContent).toContain('Please check the empty state.');
    expect(host.textContent).toContain('Lesen + kommentieren');
    const permission = host.querySelector<HTMLInputElement>('.team-board-share-permission input')!;
    expect(permission.checked).toBe(false);
    const name = host.querySelector<HTMLInputElement>('.team-board-share-controls input')!;
    const setInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setInput.call(name, 'Taylor'); name.dispatchEvent(new Event('input', { bubbles: true }));
      permission.click(); });
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Auf diesem Gerät testen')!.click(); });
    expect(create).toHaveBeenCalledWith({ projectId: 'project', displayName: 'Taylor', transport: 'local', canComment: true });
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});
