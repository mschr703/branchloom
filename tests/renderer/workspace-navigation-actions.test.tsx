// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceNavigation } from '../../src/renderer/components/WorkspaceNavigation';

afterEach(() => { document.body.replaceChildren(); });

it('opens the session view from the factual lower-left count, even when no run is active', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onView = vi.fn();
  const onOpenCard = vi.fn();
  try {
    await act(async () => { root.render(<WorkspaceNavigation activeView="board" decisionCount={0} onView={onView} onOpenCard={onOpenCard} status={{ activeCards: 2, runningSessions: 0 }} />); });
    expect(host.querySelector('.sidebar-status-live')).toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Agentensitzungen öffnen: 0 aktiv"]')!.click(); });
    expect(onView).toHaveBeenCalledWith('activity');

    await act(async () => { root.render(<WorkspaceNavigation activeView="board" decisionCount={0} onView={onView} onOpenCard={onOpenCard} status={{ activeCards: 2, runningSessions: 1, firstRunning: { cardId: 'c1', cardTitle: 'Synthetic task', agentName: 'Fixture agent' } }} />); });
    expect(host.querySelector('.sidebar-status-live')).not.toBeNull();
    await act(async () => { host.querySelector<HTMLButtonElement>('.sidebar-running-card')!.click(); });
    expect(onOpenCard).toHaveBeenCalledWith('c1');
    expect(host.textContent).not.toMatch(/\d+\s*%/);
  } finally {
    await act(async () => { root.unmount(); });
  }
});
