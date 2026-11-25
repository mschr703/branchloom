// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { BoardDependencyTrace } from '../../src/renderer/components/BoardDependencyTrace';
import type { Card, StudioAPI } from '../../src/shared/types';

it('shows a real prerequisite outside the visible board and opens its card', async () => {
  const mount = document.createElement('div');
  mount.className = 'board-page';
  mount.innerHTML = '<div class="board-card-wrap" data-card-id="dependent"><button id="board-card-dependent">Dependent task</button></div>';
  document.body.append(mount);
  const host = document.createElement('div');
  mount.append(host);
  const actualRoot = createRoot(host);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onOpenCard = vi.fn();
  const cardRunGate = vi.fn<StudioAPI['cardRunGate']>().mockResolvedValue({
    cardId: 'dependent', projectId: 'p', capacity: 2, runningCount: 0, running: [],
    dependency: null, blockers: ['Prerequisite pending'], canStart: false,
    dependencies: [
      { prerequisiteCardId: 'source', prerequisiteTitle: 'Prepare database', source: 'manual', status: 'blocked', approvalNote: null, reports: [] },
      { prerequisiteCardId: 'source-2', prerequisiteTitle: 'Confirm access', source: 'manual', status: 'blocked', approvalNote: null, reports: [] },
    ],
  });
  Object.defineProperty(window, 'studio', { configurable: true, value: { cardRunGate } });
  const cards: Card[] = [{ id: 'dependent', projectId: 'p', columnId: 'todo', title: 'Dependent task', description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01', archivedAt: null }];
  try {
    await act(async () => { actualRoot.render(<BoardDependencyTrace projectId="p" cards={cards} onOpenCard={onOpenCard} />); });
    expect(mount.textContent).not.toContain('Prepare database');
    await act(async () => { mount.querySelector('#board-card-dependent')!.dispatchEvent(new Event('pointerover', { bubbles: true })); });
    expect(cardRunGate).toHaveBeenCalledWith('dependent');
    const prerequisite = mount.querySelector<HTMLButtonElement>('.board-dependency-hidden button');
    expect(prerequisite?.textContent).toContain('Prepare database');
    await act(async () => { prerequisite!.click(); });
    expect(onOpenCard).toHaveBeenCalledWith('source');
    const source = document.createElement('button');
    source.id = 'board-card-source';
    source.getBoundingClientRect = () => new DOMRect(20, 20, 100, 60);
    mount.querySelector('#board-card-dependent')!.getBoundingClientRect = () => new DOMRect(260, 120, 100, 60);
    mount.append(source);
    await act(async () => { mount.querySelector('#board-card-dependent')!.dispatchEvent(new Event('pointerout', { bubbles: true })); });
    await act(async () => { mount.querySelector('#board-card-dependent')!.dispatchEvent(new Event('pointerover', { bubbles: true })); });
    expect(document.body.querySelector('.board-dependency-line')).not.toBeNull();
    expect(mount.querySelector('.board-dependency-hidden')).toBeNull();
    expect(source.classList.contains('dependency-source')).toBe(true);
    await act(async () => { mount.querySelector<HTMLButtonElement>('[aria-label="Nächsten Vorgänger zeigen"]')!.click(); });
    expect(mount.querySelector('.board-dependency-hidden')?.textContent).toContain('Confirm access');
    expect(document.body.querySelector('.board-dependency-line')).toBeNull();
    expect(source.classList.contains('dependency-source')).toBe(false);
  } finally {
    await act(async () => { actualRoot.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    mount.remove();
  }
});
