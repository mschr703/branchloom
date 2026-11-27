import type { AgentPreset, Card, Session } from '../shared/types';
import { validCalendarDate } from '../shared/card-schedule';

export interface CalendarCardEvent { id: string; cardId: string; title: string; date: string; kind: 'planned' | 'completed' }
export interface CalendarAgendaEvent {
  id: string;
  cardId: string | null;
  title: string;
  date: string;
  time: string | null;
  kind: 'planned' | 'completed' | 'run-started' | 'run-ended';
  detail: string;
}

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

/** Keep planned dates, explicit completions, and observed agent work distinct. */
export function projectAgendaEvents(cards: Card[], sessions: Session[], agents: AgentPreset[]): CalendarAgendaEvent[] {
  const entries: CalendarAgendaEvent[] = cardCalendarEvents(cards).map((event) => ({
    ...event, time: null, detail: event.kind === 'planned' ? 'Geplanter Kartentermin' : 'Abschluss ausdrücklich markiert',
  }));
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  for (const session of sessions) {
    const started = new Date(session.startedAt);
    const card = cardsById.get(session.cardId);
    const agentName = agentsById.get(session.agentId)?.name ?? 'Agent';
    const title = card?.title ?? 'Karte nicht mehr vorhanden';
    const cardId = card ? card.id : null;
    if (Number.isFinite(started.getTime())) entries.push({ id: `${session.id}:started`, cardId, title, date: localDateKey(started),
      time: started.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), kind: 'run-started', detail: `${agentName} gestartet` });
    if (!session.endedAt) continue;
    const ended = new Date(session.endedAt);
    if (!Number.isFinite(ended.getTime())) continue;
    const outcome = session.state === 'stopped' ? 'gestoppt'
      : session.state === 'failed' || (session.exitCode !== null && session.exitCode !== 0) ? 'fehlgeschlagen'
        : session.state === 'exited' && session.exitCode === 0 ? 'beendet' : 'Ergebnis unbekannt';
    entries.push({ id: `${session.id}:ended`, cardId, title, date: localDateKey(ended),
      time: ended.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }), kind: 'run-ended',
      detail: outcome === 'Ergebnis unbekannt' ? `${agentName} · Ergebnis unbekannt` : `${agentName} · Lauf ${outcome}` });
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title));
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
