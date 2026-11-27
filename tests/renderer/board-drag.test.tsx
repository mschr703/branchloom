// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSnapshot } from '../../src/shared/types';
import { BoardView } from '../../src/renderer/components/BoardView';

const stamp = '2026-01-01T00:00:00.000Z';
const snapshot = {
  project: { id: 'project', name: 'Synthetic project', path: 'C:\\synthetic', createdAt: stamp },
  columns: [
    { id: 'todo', projectId: 'project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null },
    { id: 'review', projectId: 'project', name: 'Review', position: 1, autoStart: false, agentId: null, model: null, effort: null },
  ],
  cards: [{ id: 'card', projectId: 'project', columnId: 'todo', title: 'Move this card', description: '', priority: 'none', labels: [], position: 0, createdAt: stamp, updatedAt: stamp, archivedAt: null }],
  agents: [], sessions: [], workflows: [], notes: [],
} as ProjectSnapshot;

function dragEvent(type: string, dataTransfer: object, point?: { x: number; y: number }): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  if (point) {
    Object.defineProperty(event, 'clientX', { value: point.x });
    Object.defineProperty(event, 'clientY', { value: point.y });
  }
  return event;
}

function pointerEvent(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }))
    Object.defineProperty(event, key, { value });
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(window, 'studio');
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

describe('board card drag feedback', () => {
  it('lifts a visual copy, marks the destination, and moves the real card only on drop', async () => {
    const moveCard = vi.fn().mockResolvedValue({ ...snapshot.cards[0], columnId: 'review' });
    const animate = vi.fn();
    const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
    Object.defineProperty(Element.prototype, 'animate', { configurable: true, value: animate });
    Object.defineProperty(window, 'studio', { configurable: true, value: { moveCard, cardRunGate: vi.fn().mockResolvedValue({ cardId: 'card', projectId: 'project', dependencies: [] }) } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const transfer = {
      types: ['text/card-id'],
      setData: vi.fn(),
      getData: vi.fn().mockReturnValue('card'),
      setDragImage: vi.fn(),
      effectAllowed: '',
      dropEffect: '',
    };
    try {
      await act(async () => root.render(<BoardView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} />));
      const card = host.querySelector<HTMLButtonElement>('#board-card-card')!;
      const destination = host.querySelector<HTMLElement>('[data-column-id="review"]')!;
      await act(async () => { card.dispatchEvent(dragEvent('dragstart', transfer)); });
      expect(transfer.setData).toHaveBeenCalledWith('text/card-id', 'card');
      expect(transfer.setDragImage).toHaveBeenCalledOnce();
      expect(document.querySelector('.board-drag-preview[aria-hidden="true"]')).not.toBeNull();
      expect(host.querySelector('.is-drag-origin')).not.toBeNull();
      expect(moveCard).not.toHaveBeenCalled();

      const scroll = host.querySelector<HTMLElement>('.board-scroll')!;
      vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 500, top: 0, bottom: 600 } as DOMRect);
      await act(async () => { destination.dispatchEvent(dragEvent('dragover', transfer, { x: 490, y: 200 })); });
      expect(destination.classList.contains('is-drop-target')).toBe(true);
      expect(scroll.scrollLeft).toBe(22);
      await act(async () => { destination.dispatchEvent(dragEvent('drop', transfer)); });
      expect(moveCard).toHaveBeenCalledWith({ id: 'card', columnId: 'review' });
      expect(document.querySelector('.board-drag-preview')).toBeNull();
      expect(destination.classList.contains('is-drop-target')).toBe(false);
      await act(async () => root.render(<BoardView snapshot={{ ...snapshot, cards: [{ ...snapshot.cards[0]!, columnId: 'review' }] }} mutate={async <T,>(action: () => Promise<T>) => action()} />));
      expect(animate).toHaveBeenCalledOnce();
      expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 390 });
    } finally {
      await act(async () => root.unmount());
      if (originalAnimate) Object.defineProperty(Element.prototype, 'animate', originalAnimate);
      else Reflect.deleteProperty(Element.prototype, 'animate');
      host.remove();
    }
  });

  it('removes the floating copy when drag is cancelled', async () => {
    Object.defineProperty(window, 'studio', { configurable: true, value: {} });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const transfer = { types: ['text/card-id'], setData: vi.fn(), getData: vi.fn().mockReturnValue('card'), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '' };
    try {
      await act(async () => root.render(<BoardView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} />));
      const card = host.querySelector<HTMLButtonElement>('#board-card-card')!;
      await act(async () => { card.dispatchEvent(dragEvent('dragstart', transfer)); });
      expect(document.querySelector('.board-drag-preview')).not.toBeNull();
      await act(async () => { card.dispatchEvent(dragEvent('dragend', transfer)); });
      expect(document.querySelector('.board-drag-preview')).toBeNull();
      expect(host.querySelector('.is-drag-origin')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('moves a card by touch while keeping a tap and vertical scroll distinct', async () => {
    const moveCard = vi.fn().mockResolvedValue({ ...snapshot.cards[0], columnId: 'review' });
    Object.defineProperty(window, 'studio', { configurable: true, value: { moveCard,
      cardRunGate: vi.fn().mockResolvedValue({ cardId: 'card', projectId: 'project', dependencies: [] }) } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    try {
      await act(async () => root.render(<BoardView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} />));
      const card = host.querySelector<HTMLButtonElement>('#board-card-card')!;
      const destination = host.querySelector<HTMLElement>('[data-column-id="review"]')!;
      const scroll = host.querySelector<HTMLElement>('.board-scroll')!;
      vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 230, top: 0, bottom: 300 } as DOMRect);
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (x: number) => x >= 180 ? destination : card });

      await act(async () => {
        card.dispatchEvent(pointerEvent('pointerdown', 80, 100));
        card.dispatchEvent(pointerEvent('pointermove', 86, 130));
      });
      expect(document.querySelector('.board-drag-preview')).toBeNull();
      expect(moveCard).not.toHaveBeenCalled();
      await act(async () => { card.dispatchEvent(pointerEvent('pointerup', 86, 130)); });

      await act(async () => {
        card.dispatchEvent(pointerEvent('pointerdown', 80, 100));
        card.dispatchEvent(pointerEvent('pointermove', 220, 108));
      });
      expect(document.querySelector('.board-drag-preview')).not.toBeNull();
      expect(destination.classList.contains('is-drop-target')).toBe(true);
      expect(scroll.scrollLeft).toBeGreaterThan(0);
      expect(moveCard).not.toHaveBeenCalled();
      await act(async () => { card.dispatchEvent(pointerEvent('pointerup', 220, 108)); });
      expect(moveCard).toHaveBeenCalledExactlyOnceWith({ id: 'card', columnId: 'review' });
      expect(document.querySelector('.board-drag-preview')).toBeNull();
      expect(destination.classList.contains('is-drop-target')).toBe(false);
      await act(async () => { card.click(); });
      expect(host.querySelector('.card-drawer')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      if (originalElementFromPoint) Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint);
      else Reflect.deleteProperty(document, 'elementFromPoint');
      host.remove();
    }
  });

  it('cancels a touch drag without moving or leaving a floating card', async () => {
    const moveCard = vi.fn();
    Object.defineProperty(window, 'studio', { configurable: true, value: { moveCard } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<BoardView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} />));
      const card = host.querySelector<HTMLButtonElement>('#board-card-card')!;
      await act(async () => {
        card.dispatchEvent(pointerEvent('pointerdown', 80, 100));
        card.dispatchEvent(pointerEvent('pointermove', 190, 104));
      });
      expect(document.querySelector('.board-drag-preview')).not.toBeNull();
      await act(async () => { card.dispatchEvent(pointerEvent('pointercancel', 190, 104)); });
      expect(document.querySelector('.board-drag-preview')).toBeNull();
      expect(host.querySelector('.is-drag-origin')).toBeNull();
      expect(moveCard).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
