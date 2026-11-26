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
