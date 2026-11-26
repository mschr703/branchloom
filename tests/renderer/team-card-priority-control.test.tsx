// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TeamCardPriorityControl } from '../../src/renderer/components/TeamCardPriorityControl';

it('shows a stale team card conflict and requires an explicit reload', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const update = vi.fn().mockRejectedValueOnce(new Error('Team card changed. Reload before retrying.'));
  const reload = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, 'studio', { configurable: true, value: { setTeamCardPriority: update } });
  try {
    await act(async () => { root.render(<TeamCardPriorityControl workspaceId="workspace" projectId="project"
      card={{ id: 'card', priority: 'none', revision: 2 }} onReload={reload} />); });
    const select = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'high');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { host.querySelector<HTMLButtonElement>('.secondary-button')!.click(); });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'card', expectedRevision: 2,
      priority: 'high', mutationId: expect.any(String) }));
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
