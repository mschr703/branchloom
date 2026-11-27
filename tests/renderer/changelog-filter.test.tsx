// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChangelogView } from '../../src/renderer/components/ChangelogView';
import type { ProjectChangelog } from '../../src/shared/changelog';

const report: ProjectChangelog = {
  projectId: 'synthetic', period: 'week', since: '2026-01-01T00:00:00Z', until: '2026-01-03T12:00:00Z',
  checkedAt: '2026-01-03T12:00:00Z', scope: 'head', state: 'ready', head: 'a'.repeat(40),
  commits: [
    { hash: 'a'.repeat(40), committedAt: '2026-01-03T10:00:00Z', subject: 'Alex commit', authorName: 'Alex Git' },
    { hash: 'b'.repeat(40), committedAt: '2026-01-03T09:00:00Z', subject: 'Jo commit', authorName: 'Jo Git' },
  ],
  moreAvailable: false, issues: [], checkedWorktrees: 0,
  qaObservations: [{ id: 'qa-1', cardId: 'card-1', cardTitle: 'Browser check', endedAt: '2026-01-03T11:00:00Z',
    status: 'passed', checkoutState: 'clean', checkoutHead: 'a'.repeat(40) }], qaTotal: 1,
  reviewActivity: [], reviewTotal: 0, integrationReceipts: [], integrationTotal: 0,
};

afterEach(() => { document.body.replaceChildren(); });

describe('changelog filters', () => {
  it('filters the loaded chronology without changing its recorded evidence or refetching', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const projectChangelog = vi.fn().mockResolvedValue(report);
    const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    Object.defineProperty(window, 'studio', { configurable: true, value: { projectChangelog } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(<ChangelogView projectId="synthetic" />); });
      expect(host.querySelector('.changelog-timeline')?.textContent).toContain('Browser check');
      const controls = [...host.querySelectorAll<HTMLSelectElement>('.changelog-controls select')];
      const events = controls[2]!;
      const authors = controls[3]!;
      await act(async () => { events.value = 'code'; events.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(host.querySelector('.changelog-timeline')?.textContent).not.toContain('Browser check');
      await act(async () => { authors.value = 'Alex Git'; authors.dispatchEvent(new Event('change', { bubbles: true })); });
      expect(host.querySelector('.changelog-timeline')?.textContent).toContain('Alex commit');
      expect(host.querySelector('.changelog-timeline')?.textContent).not.toContain('Jo commit');
      expect(projectChangelog).toHaveBeenCalledOnce();
      expect(host.querySelector('.changelog-checks')?.textContent).toContain('Browser check');
    } finally {
      await act(async () => { root.unmount(); });
      if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });
});
