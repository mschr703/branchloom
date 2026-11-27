import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Card, ProjectSnapshot, Session } from '../../src/shared/types';
import { calendarMonthDays, cardCalendarEvents, localDateKey, projectAgendaEvents } from '../../src/renderer/calendar-model';
import { ProjectCalendarView } from '../../src/renderer/components/ProjectCalendarView';

const card: Card = {
  id: 'card-1', projectId: 'project', columnId: 'done', title: 'Ship the page', description: '',
  priority: 'none', labels: [], position: 0, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', archivedAt: null,
  plannedDueDate: '2026-12-04', completedAt: '2026-12-06T15:30:00.000Z',
};

describe('project calendar', () => {
  it('shows a planned date and a distinct observed completion on their respective days', () => {
    expect(cardCalendarEvents([card])).toEqual([
      { id: 'card-1:planned', cardId: card.id, title: card.title, date: '2026-12-04', kind: 'planned' },
      { id: 'card-1:completed', cardId: card.id, title: card.title, date: localDateKey(new Date(card.completedAt!)), kind: 'completed' },
    ]);
    expect(cardCalendarEvents([{ ...card, id: 'old', plannedDueDate: undefined, completedAt: null }])).toEqual([]);
    expect(cardCalendarEvents([{ ...card, id: 'invalid', plannedDueDate: '2026-02-30', completedAt: 'nope' }])).toEqual([]);
  });

  it('builds Monday-first weeks with adjacent days for calendar navigation', () => {
    const days = calendarMonthDays(2026, 11);
    expect(days[0]).toMatchObject({ date: '2026-11-30', inMonth: false });
    expect(days.at(-1)).toMatchObject({ date: '2027-01-03', inMonth: false });
    expect(days).toHaveLength(35);
  });

  it('records only observed agent start and end events with an honest outcome', () => {
    const session: Session = {
      id: 'session-1', projectId: 'project', cardId: card.id, agentId: 'agent-1', state: 'exited',
      startedAt: '2026-12-04T09:20:00.000Z', endedAt: '2026-12-04T10:10:00.000Z', exitCode: null, output: '',
    };
    const entries = projectAgendaEvents([card], [session], [{ id: 'agent-1', name: 'Atlas', kind: 'custom', command: 'node', args: [], model: null, enabled: true }]);
    expect(entries.map((entry) => entry.kind)).toContain('run-started');
    expect(entries.find((entry) => entry.id === 'session-1:started')?.detail).toBe('Atlas gestartet');
    expect(entries.find((entry) => entry.id === 'session-1:ended')?.detail).toBe('Atlas · Ergebnis unbekannt');
    expect(projectAgendaEvents([], [{ ...session, startedAt: 'bad', endedAt: 'bad' }], [])).toEqual([]);
    expect(projectAgendaEvents([], [{ ...session, state: 'running', endedAt: null }], []).filter((entry) => entry.kind === 'run-ended')).toEqual([]);
    expect(projectAgendaEvents([card], [{ ...session, exitCode: 0 }], []).find((entry) => entry.kind === 'run-ended')?.detail).toBe('Agent · Lauf beendet');
  });

  it('renders an accessible calendar without pretending a Done column is a completion', () => {
    const snapshot = { cards: [{ ...card, completedAt: null }] } as ProjectSnapshot;
    const html = renderToStaticMarkup(createElement(ProjectCalendarView, { snapshot, onOpenCard: () => undefined }));
    expect(html).toContain('aria-label="Projektkalender"');
    expect(html).toContain('Geplant');
    expect(html).toContain('Erledigt (manuell markiert)');
    expect(html).toContain('aria-label="Vorheriger Monat"');
    expect(html).toContain('aria-label="Nächster Monat"');
  });
});
