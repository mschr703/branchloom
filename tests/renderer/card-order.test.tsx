// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Card, ProjectSnapshot } from '../../src/shared/types';
import { BoardView } from '../../src/renderer/components/BoardView';
import { filterBoardCards } from '../../src/renderer/board-filters';

const stamp = '2026-01-01T00:00:00.000Z';
function card(id: string, position: number, archivedAt: string | null = null): Card {
  return { id, projectId: 'p', columnId: 'todo', title: id, description: '', priority: 'none', labels: [], position, createdAt: stamp, updatedAt: stamp, archivedAt };
}

describe('board card order controls', () => {
  it('renders saved order and offers neighboring actions in each card menu', async () => {
    const snapshot: ProjectSnapshot = {
      project: { id: 'p', name: 'Synthetic', path: 'C:\\synthetic', createdAt: stamp },
      columns: [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
      cards: [card('third', 2), card('first', 0), card('archived', 3, stamp), card('second', 1)],
      agents: [], sessions: [], workflows: [], notes: [],
      queue: { projectId: 'p', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
    Object.defineProperty(window, 'studio', { configurable: true, value: { cardRunGate: vi.fn().mockResolvedValue({ cardId: 'second', projectId: 'p', dependencies: [] }) } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(BoardView, { snapshot, mutate: async <T,>(action: () => Promise<T>) => action() })); });
      const ids = [...host.querySelectorAll('.board-card-wrap')].map((item) => item.getAttribute('data-card-id'));
      expect(ids).toEqual(['first', 'second', 'third']);
      await act(async () => { host.querySelector<HTMLButtonElement>('[data-card-id="second"] .card-quick-trigger')!.click(); });
      expect(document.querySelector('#card-actions-second')?.textContent).toContain('Vor „first“ setzen');
      expect(document.querySelector('#card-actions-second')?.textContent).toContain('Hinter „third“ setzen');
      await act(async () => { host.querySelector<HTMLButtonElement>('[data-card-id="first"] .card-quick-trigger')!.click(); });
      expect(document.querySelector('#card-actions-first')?.textContent).not.toContain('Vor „');
      expect(document.querySelector('#card-actions-first')?.textContent).toContain('Hinter „second“ setzen');
      expect(host.querySelector('[data-card-id="archived"]')).toBeNull();
      expect(host.textContent).toContain('auch wenn Karten ausgefiltert sind');
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      if (previousApi) Object.defineProperty(window, 'studio', previousApi);
      else Reflect.deleteProperty(window, 'studio');
    }
    expect(filterBoardCards(snapshot.cards, { query: 'second', columnId: 'todo', visibility: 'active' }).map((item) => item.id)).toEqual(['second']);
    expect(snapshot.cards.map((item) => item.position)).toEqual([2, 0, 3, 1]);
  });
});
