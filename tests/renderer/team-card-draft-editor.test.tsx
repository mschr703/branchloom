// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { TeamCardDraftEditor } from '../../src/renderer/components/TeamCardDraftEditor';
import type { TeamDraftWindowEvent } from '../../src/shared/types';

const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');

afterEach(() => {
  if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
  if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

function setup(update = vi.fn().mockResolvedValue({ update: '', revision: 1, repeated: false })) {
  let onEvent: ((event: TeamDraftWindowEvent) => void) | null = null;
  const start = vi.fn().mockResolvedValue(undefined);
  const resume = vi.fn().mockResolvedValue(0);
  const draft = vi.fn().mockResolvedValue({ update: '', revision: 0 });
  Object.defineProperty(window, 'studio', { configurable: true, value: {
    pendingTeamCardDraftUpdates: vi.fn().mockResolvedValue([]), teamCardDraft: draft,
    updateTeamCardDraft: update, resumeTeamCardDraftUpdates: resume,
    onTeamDraftEvent: (callback: (event: TeamDraftWindowEvent) => void) => { onEvent = callback; return () => { onEvent = null; }; },
    startTeamDraftWatch: start, stopTeamDraftWatch: vi.fn().mockResolvedValue(undefined),
  } });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const emit = (payload: Omit<TeamDraftWindowEvent, 'watchId'>) => {
    const watchId = start.mock.calls[0]?.[0]?.watchId;
    if (!watchId || !onEvent) throw new Error('Team watch was not started.');
    onEvent({ watchId, ...payload } as TeamDraftWindowEvent);
  };
  return { host, root, update, resume, draft, emit,
    async cleanup() { await act(async () => { root.unmount(); }); host.remove(); } };
}

it('shows only authenticated current viewers while the live card stream is connected', async () => {
  const view = setup();
  try {
    await act(async () => { view.root.render(<TeamCardDraftEditor workspaceId="workspace" projectId="project"
      cardId="card" cardTitle="Plan the flow" canEdit />); });
    expect(view.host.textContent).toContain('Live-Verbindung wird aufgebaut');
    await act(async () => { view.emit({ type: 'connected' }); view.emit({ event: { type: 'presence', members: [
      { memberId: 'member-a', displayName: 'Alex' }, { memberId: 'member-b', displayName: 'Sam' },
    ] } }); });
    expect(view.host.textContent).toContain('Geöffnet von: Alex, Sam');
    expect(view.host.textContent).toContain('Live verbunden');
    await act(async () => { view.emit({ type: 'error', message: 'Connection lost' }); });
    expect(view.host.textContent).not.toContain('Geöffnet von: Alex, Sam');
    expect(view.host.textContent).toContain('Live-Verbindung unterbrochen');
  } finally { await view.cleanup(); }
});

it('keeps an unconfirmed local edit visible and retries the original mutation without remounting', async () => {
  const update = vi.fn().mockRejectedValueOnce(new Error('Coordinator unavailable'))
    .mockResolvedValueOnce({ update: '', revision: 1, repeated: true });
  const view = setup(update);
  try {
    await act(async () => { view.root.render(<TeamCardDraftEditor workspaceId="workspace" projectId="project"
      cardId="card" cardTitle="Plan the flow" canEdit />); });
    const input = view.host.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Shared plan');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('Shared plan');
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('Host-Bestätigung');
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('Geschütztes lokales Speichern kann');
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.team-card-sync-error button')!.click(); });
    expect(view.resume).toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]?.[0].mutationId).toBe(update.mock.calls[0]?.[0].mutationId);
    expect(input.value).toBe('Shared plan');
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
    expect(view.host.textContent).toContain('Synchronisiert · Stand 1');
  } finally { await view.cleanup(); }
});

it('keeps a read-only guest out of draft writes', async () => {
  const view = setup();
  try {
    await act(async () => { view.root.render(<TeamCardDraftEditor workspaceId="workspace" projectId="project"
      cardId="card" cardTitle="Read-only card" canEdit={false} />); });
    const input = view.host.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input.readOnly).toBe(true);
    expect(view.host.textContent).toContain('Zugang auf Lesen begrenzt');
    expect(view.update).not.toHaveBeenCalled();
  } finally { await view.cleanup(); }
});

it('lets a member retry a failed initial draft load before editing', async () => {
  const view = setup();
  view.draft.mockRejectedValueOnce(new Error('Coordinator unavailable'));
  try {
    await act(async () => { view.root.render(<TeamCardDraftEditor workspaceId="workspace" projectId="project"
      cardId="card" cardTitle="Retry card" canEdit />); });
    expect(view.host.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
    expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('Coordinator unavailable');
    await act(async () => { view.host.querySelector<HTMLButtonElement>('.team-card-sync-error button')!.click(); });
    expect(view.draft).toHaveBeenCalledTimes(2);
    expect(view.host.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(false);
    expect(view.host.querySelector('[role="alert"]')).toBeNull();
  } finally { await view.cleanup(); }
});
