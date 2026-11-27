import type { Card } from '../shared/types';
import { validCalendarDate } from '../shared/card-schedule';

export interface CalendarCardEvent { id: string; cardId: string; title: string; date: string; kind: 'planned' | 'completed' }

export function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function cardCalendarEvents(cards: Card[]): CalendarCardEvent[] {
  const events: CalendarCardEvent[] = [];
  for (const card of cards) {
    if (card.plannedDueDate && validCalendarDate(card.plannedDueDate)) events.push({ id: `${card.id}:planned`, cardId: card.id, title: card.title, date: card.plannedDueDate, kind: 'planned' });
    if (card.completedAt) {
      const at = new Date(card.completedAt);
      if (Number.isFinite(at.getTime())) events.push({ id: `${card.id}:completed`, cardId: card.id, title: card.title, date: localDateKey(at), kind: 'completed' });
    }
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title) || a.kind.localeCompare(b.kind));
}

export function calendarMonthDays(year: number, monthIndex: number): Array<{ date: string; day: number; inMonth: boolean }> {
  const first = new Date(year, monthIndex, 1);
  const start = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weeks = Math.ceil((start + daysInMonth) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => {
    const at = new Date(year, monthIndex, index - start + 1);
    return { date: localDateKey(at), day: at.getDate(), inMonth: at.getMonth() === monthIndex };
  });
}
