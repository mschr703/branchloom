// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CrossProjectInbox } from '../../src/renderer/components/CrossProjectInbox';
import { CardGuestFeedback } from '../../src/renderer/components/CardGuestFeedback';
import type { GlobalInboxItem } from '../../src/shared/global-inbox';

const originalApi = Object.getOwnPropertyDescriptor(window, 'studio');
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
afterEach(() => {
  if (originalApi) Object.defineProperty(window, 'studio', originalApi); else Reflect.deleteProperty(window, 'studio');
  if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

it('opens guest feedback in its project and removes only the inbox entry after acknowledgement', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const item: GlobalInboxItem = { id: 'guest:comment', kind: 'guest', category: 'review', projectId: 'project', projectName: 'Sample',
    sourceId: 'card', title: 'Settings page', detail: 'Gastfeedback von Alex: Check the empty state.', recordedAt: '2026-11-26T08:00:00.000Z' };
  let acknowledged = false;
  const list = vi.fn().mockImplementation(async () => ({ items: acknowledged ? [] : [item], hasMore: false, limitReached: false }));
  const acknowledge = vi.fn().mockImplementation(async () => { acknowledged = true; });
  Object.defineProperty(window, 'studio', { configurable: true, value: { globalInboxItems: list, acknowledgeGuestInboxComment: acknowledge } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const open = vi.fn();
  try {
    await act(async () => { root.render(<CrossProjectInbox onOpen={open} />); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(host.textContent).toContain('Gastfeedback');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Quelle öffnen'))!.click(); });
    expect(open).toHaveBeenCalledWith(item);
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Als gelesen markieren')!.click(); });
    expect(acknowledge).toHaveBeenCalledWith({ projectId: 'project', commentId: 'comment' });
    expect(host.querySelector('[data-global-inbox-id="guest:comment"]')).toBeNull();
  } finally { await act(async () => { root.unmount(); }); host.remove(); }
});

it('shows the original guest message on its card with escaped text', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const read = vi.fn().mockResolvedValue([{ id: 'comment', projectId: 'project', cardId: 'card', cardTitle: 'Settings page',
    inviteId: 'invite', displayName: '<Alex>', body: '<script>Check the empty state.</script>', createdAt: '2026-11-26T08:00:00.000Z' }]);
  Object.defineProperty(window, 'studio', { configurable: true, value: { teamBoardCardComments: read } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<CardGuestFeedback projectId="project" cardId="card" />); });
    expect(read).toHaveBeenCalledWith({ projectId: 'project', cardId: 'card' });
    expect(host.textContent).toContain('<script>Check the empty state.</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('.card-guest-feedback')).not.toBeNull();
  } finally { await act(async () => { root.unmount(); }); host.remove(); }
});
