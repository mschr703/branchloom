// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, ProjectSnapshot } from '../../src/shared/types';
import type { CardScheduleEvent } from '../../src/shared/card-schedule';
import type { Mutate } from '../../src/renderer/components/shared';
import { CardSchedulePanel } from '../../src/renderer/components/CardSchedulePanel';
import { ProjectCalendarView } from '../../src/renderer/components/ProjectCalendarView';
import { localDateKey } from '../../src/renderer/calendar-model';

const stamp = '2026-11-27T12:00:00.000Z';
const baseCard: Card = {
  id: 'card', projectId: 'project', columnId: 'done', title: 'Synthetic task', description: '',
  priority: 'none', labels: [], wireframeRequired: false, position: 0,
  createdAt: stamp, updatedAt: stamp, archivedAt: null, plannedDueDate: null, completedAt: null,
};

const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
afterEach(() => {
  if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
  if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

describe('calendar and schedule interactions', () => {
  it('opens the selected day and its real card from the agenda', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const plannedDueDate = localDateKey(new Date());
    const snapshot = { cards: [{ ...baseCard, plannedDueDate }] } as ProjectSnapshot;
    const onOpenCard = vi.fn();
    try {
      await act(async () => { root.render(<ProjectCalendarView snapshot={snapshot} onOpenCard={onOpenCard} />); });
      const day = host.querySelector<HTMLButtonElement>(`.project-calendar-day[aria-label*="1 geplant"]`);
      expect(day).not.toBeNull();
      await act(async () => { day!.click(); });
      expect(host.querySelector('.project-calendar-agenda')?.textContent).toContain('Synthetic task');
      await act(async () => { host.querySelector<HTMLButtonElement>('.project-calendar-event button')!.click(); });
      expect(onOpenCard).toHaveBeenCalledExactlyOnceWith('card');
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('shows observed agent work in the monthly agenda and switches to one day', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const startedAt = new Date().toISOString();
    const snapshot = {
      cards: [baseCard], agents: [{ id: 'agent', name: 'Atlas' }],
      sessions: [{ id: 'run', projectId: 'project', cardId: baseCard.id, agentId: 'agent', state: 'running', startedAt, endedAt: null, exitCode: null, output: '' }],
    } as ProjectSnapshot;
    try {
      await act(async () => { root.render(<ProjectCalendarView snapshot={snapshot} onOpenCard={() => undefined} />); });
      expect(host.querySelector('.project-calendar-agenda')?.textContent).toContain('Atlas gestartet');
      expect(host.querySelector('.project-calendar-agenda-scope [aria-pressed="true"]')?.textContent).toBe('Monat');
      const day = host.querySelector<HTMLButtonElement>('.project-calendar-day[aria-label*="1 Agentenläufe"]');
      expect(day).not.toBeNull();
      await act(async () => { day!.click(); });
      expect(host.querySelector('.project-calendar-agenda-scope [aria-pressed="true"]')?.textContent).toBe('Tag');
      expect(host.querySelector('.project-calendar-agenda')?.textContent).toContain('Synthetic task');
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });

  it('saves a planned day and records a separately marked completion in the visible history', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    let current = baseCard;
    const events: CardScheduleEvent[] = [];
    const updateCard = vi.fn(async ({ plannedDueDate }: { id: string; plannedDueDate: string | null }) => {
      current = { ...current, plannedDueDate };
      events.unshift({ id: 'planned', cardId: current.id, kind: 'planned-date', before: null, after: plannedDueDate, recordedAt: stamp });
      return current;
    });
    const setCardCompleted = vi.fn(async ({ completed }: { id: string; completed: boolean }) => {
      current = { ...current, completedAt: completed ? stamp : null };
      events.unshift({ id: 'done', cardId: current.id, kind: 'completion', before: null, after: current.completedAt ?? null, recordedAt: stamp });
      return current;
    });
    Object.defineProperty(window, 'studio', { configurable: true, value: {
      updateCard, setCardCompleted, cardScheduleEvents: vi.fn(async () => [...events]),
    } });
    function Harness() {
      const [card, setCard] = useState(baseCard);
      const mutate: Mutate = async <T,>(action: () => Promise<T>): Promise<T | null> => {
        const result = await action();
        if (result && typeof result === 'object' && 'id' in result) setCard(result as Card);
        return result;
      };
      return <CardSchedulePanel card={card} mutate={mutate} />;
    }
    try {
      await act(async () => { root.render(<Harness />); });
      const details = host.querySelector<HTMLDetailsElement>('.card-schedule-panel')!;
      await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: true })); });
      const input = host.querySelector<HTMLInputElement>('input[type="date"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2026-12-04');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => { host.querySelector<HTMLButtonElement>('.card-schedule-controls button')!.click(); });
      expect(updateCard).toHaveBeenCalledWith({ id: 'card', plannedDueDate: '2026-12-04' });
      expect(host.querySelector('.card-schedule-panel summary')?.textContent).toContain('2026-12-04');
      await act(async () => { host.querySelector<HTMLButtonElement>('.card-schedule-completion button')!.click(); });
      expect(setCardCompleted).toHaveBeenCalledWith({ id: 'card', completed: true });
      expect(host.querySelector('.card-schedule-completion')?.textContent).toContain('Erledigt am');
      const history = host.querySelector<HTMLDetailsElement>('.card-schedule-history');
      expect(history?.textContent).toContain('Als erledigt markiert');
      expect(history?.textContent).toContain('Geplant für 2026-12-04');
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
    }
  });
});
