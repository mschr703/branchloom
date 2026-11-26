// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TeamCardColumnControl } from '../../src/renderer/components/TeamCardColumnControl';

it('sends a revisioned team move and exposes a stale-card conflict', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const move = vi.fn().mockRejectedValueOnce(new Error('Card changed. Reload before applying this team action.'));
  const reload = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'studio', { configurable: true, value: { moveTeamCard: move } });
  try {
    await act(async () => { root.render(<TeamCardColumnControl workspaceId="workspace" projectId="project"
      card={{ id: 'card', columnId: 'todo', revision: 4 }} columns={[{ id: 'todo', name: 'To Do' },
        { id: 'review', name: 'Review' }]} onReload={reload} />); });
    const select = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'review');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { host.querySelector<HTMLButtonElement>('.secondary-button')!.click(); });
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card', columnId: 'review',
      expectedRevision: 4, mutationId: expect.any(String) }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('inzwischen geändert');
    expect(reload).not.toHaveBeenCalled();
    await act(async () => { host.querySelector<HTMLButtonElement>('.inline-error button')!.click(); });
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});

it('shows the host agent consequence and reports a confirmed launch', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const move = vi.fn().mockResolvedValue({ cardId: 'card', columnId: 'run', revision: 5, repeated: false,
    agentLaunch: { state: 'started', agentId: 'agent', sessionId: 'session' } });
  const saved = vi.fn();
  Object.defineProperty(window, 'studio', { configurable: true, value: { moveTeamCard: move } });
  try {
    await act(async () => { root.render(<TeamCardColumnControl workspaceId="workspace" projectId="project"
      card={{ id: 'card', columnId: 'todo', revision: 4 }} columns={[{ id: 'todo', name: 'To Do' },
        { id: 'run', name: 'Team run', startsAgent: true }]} onReload={async () => undefined} onSaved={saved} />); });
    const select = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'run');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('.team-card-start-warning')?.textContent).toContain('Git-Worktree');
    await act(async () => { host.querySelector<HTMLButtonElement>('.secondary-button')!.click(); });
    expect(saved).toHaveBeenCalledWith('started');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});

it('reuses the move ID after a lost coordinator response', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const move = vi.fn().mockRejectedValueOnce(new Error('Coordinator is unavailable.'))
    .mockResolvedValueOnce({ cardId: 'card', columnId: 'run', revision: 5, repeated: true,
      agentLaunch: { state: 'started', agentId: 'agent', sessionId: 'session' } });
  const saved = vi.fn();
  Object.defineProperty(window, 'studio', { configurable: true, value: { moveTeamCard: move } });
  try {
    await act(async () => { root.render(<TeamCardColumnControl workspaceId="workspace" projectId="project"
      card={{ id: 'card', columnId: 'todo', revision: 4 }} columns={[{ id: 'todo', name: 'To Do' },
        { id: 'run', name: 'Run', startsAgent: true }]} onReload={async () => undefined} onSaved={saved} />); });
    const select = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'run');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const button = host.querySelector<HTMLButtonElement>('.secondary-button')!;
    await act(async () => { button.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Verbindung unterbrochen');
    await act(async () => { button.click(); });
    expect(move).toHaveBeenCalledTimes(2);
    expect(move.mock.calls[1]?.[0].mutationId).toBe(move.mock.calls[0]?.[0].mutationId);
    expect(saved).toHaveBeenCalledWith('started');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    host.remove();
  }
});
