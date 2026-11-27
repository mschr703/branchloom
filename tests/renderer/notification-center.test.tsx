// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GlobalInboxItem, GlobalInboxPage } from '../../src/shared/global-inbox';
import type { ReleaseUpdateState } from '../../src/shared/release-update';
import { NotificationCenter, hasActionableUpdate, notificationFingerprint, readSeenNotifications, recordSeenNotifications, unreadRecentCount } from '../../src/renderer/components/NotificationCenter';

const item: GlobalInboxItem = {
  id: 'guest:sample', kind: 'guest', category: 'review', projectId: 'p', projectName: 'Synthetic',
  sourceId: 'card-a', title: 'Review card', detail: 'A test guest left feedback.', recordedAt: '2026-11-27T12:00:00.000Z',
};
const page: GlobalInboxPage = { items: [item], hasMore: false, limitReached: false };
const current: ReleaseUpdateState = { phase: 'current', currentVersion: '0.1.3', availableVersion: null, percent: null, message: null };

afterEach(() => { document.body.replaceChildren(); window.localStorage.clear(); });

describe('notification center', () => {
  it('counts only unseen persisted source versions and real actionable updates', () => {
    expect(unreadRecentCount(page, [])).toBe(1);
    const seen = recordSeenNotifications(window.localStorage, [], [item]);
    expect(readSeenNotifications(window.localStorage)).toEqual([notificationFingerprint(item)]);
    expect(unreadRecentCount(page, seen)).toBe(0);
    expect(unreadRecentCount({ ...page, items: [{ ...item, recordedAt: '2026-11-27T13:00:00.000Z' }] }, seen)).toBe(1);
    expect(hasActionableUpdate(current)).toBe(false);
    expect(hasActionableUpdate({ ...current, phase: 'available', availableVersion: '0.1.4' })).toBe(true);
    expect(hasActionableUpdate({ ...current, phase: 'error', message: 'Offline' })).toBe(false);
  });

  it('opens a saved event at its source and persists its read marker', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const onOpenItem = vi.fn();
    const onOpenInbox = vi.fn();
    const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    Object.defineProperty(window, 'studio', { configurable: true, value: {
      globalInboxItems: vi.fn().mockResolvedValue(page),
      releaseUpdateState: vi.fn().mockResolvedValue(current),
      onReleaseUpdateState: vi.fn().mockReturnValue(() => undefined),
    } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(<NotificationCenter onOpenItem={onOpenItem} onOpenInbox={onOpenInbox} />); });
      expect(host.querySelector('.notification-count')?.textContent).toBe('1');
      await act(async () => { host.querySelector<HTMLButtonElement>('.notification-trigger')!.click(); });
      expect(host.textContent).toContain('Gastfeedback · Synthetic');
      await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      expect(host.querySelector('.notification-panel')).toBeNull();
      expect(document.activeElement).toBe(host.querySelector('.notification-trigger'));
      await act(async () => { host.querySelector<HTMLButtonElement>('.notification-trigger')!.click(); });
      await act(async () => { host.querySelector<HTMLButtonElement>('.notification-item')!.click(); });
      expect(onOpenItem).toHaveBeenCalledWith(item);
      expect(readSeenNotifications(window.localStorage)).toContain(notificationFingerprint(item));
      expect(host.querySelector('.notification-count')).toBeNull();
      expect(host.querySelector('.notification-panel')).toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });

  it('shows a verified available release inside the bell, not as an ambient popup', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    const available: ReleaseUpdateState = { ...current, phase: 'available', availableVersion: '0.1.4' };
    const installReleaseUpdate = vi.fn().mockResolvedValue({ ...available, phase: 'downloading', percent: 0 });
    Object.defineProperty(window, 'studio', { configurable: true, value: {
      globalInboxItems: vi.fn().mockResolvedValue({ ...page, items: [] }),
      releaseUpdateState: vi.fn().mockResolvedValue(available),
      onReleaseUpdateState: vi.fn().mockReturnValue(() => undefined),
      installReleaseUpdate,
      laterReleaseUpdate: vi.fn().mockResolvedValue(current),
    } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(<NotificationCenter onOpenItem={() => undefined} onOpenInbox={() => undefined} />); });
      expect(host.querySelector('.notification-count')?.textContent).toBe('1');
      expect(host.textContent).not.toContain('Update 0.1.4 verfügbar');
      await act(async () => { host.querySelector<HTMLButtonElement>('.notification-trigger')!.click(); });
      expect(host.textContent).toContain('Update 0.1.4 verfügbar');
      expect(host.querySelector('.release-update-notice')).not.toBeNull();
      await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('.release-update-actions button')].find((button) => button.textContent === 'Aktualisieren')!.click(); });
      expect(installReleaseUpdate).toHaveBeenCalledOnce();
      expect(host.textContent).toContain('Update wird geladen');
    } finally {
      await act(async () => { root.unmount(); });
      if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });
});
