import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { calendarMonthDays, cardCalendarEvents, localDateKey } from '../calendar-model';
import './project-calendar.css';

const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const monthLabel = (date: Date) => date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

export function ProjectCalendarView({ snapshot, onOpenCard }: { snapshot: ProjectSnapshot; onOpenCard: (cardId: string) => void }) {
  const today = localDateKey(new Date());
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const events = useMemo(() => cardCalendarEvents(snapshot.cards), [snapshot.cards]);
  const days = calendarMonthDays(month.getFullYear(), month.getMonth());
  const byDate = new Map<string, typeof events>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const selectedEvents = byDate.get(selected) ?? [];
  const monthPrefix = localDateKey(month).slice(0, 7);
  const monthEvents = events.filter((event) => event.date.startsWith(monthPrefix));

  function shiftMonth(step: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + step, 1);
    setMonth(next);
    setSelected(localDateKey(next));
  }

  return <section className="project-calendar standard-page" aria-label="Projektkalender">
    <header className="project-calendar-header"><div><h2>Kalender</h2><p>Geplante Termine und tatsächlich markierte Abschlüsse der Projektkarten.</p></div>
      <div className="project-calendar-month-controls"><button type="button" className="icon-button" aria-label="Vorheriger Monat" onClick={() => shiftMonth(-1)}><ChevronLeft size={17} /></button><strong>{monthLabel(month)}</strong><button type="button" className="icon-button" aria-label="Nächster Monat" onClick={() => shiftMonth(1)}><ChevronRight size={17} /></button><button type="button" className="secondary-button small" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(localDateKey(now)); }}>Heute</button></div>
    </header>
    <div className="project-calendar-legend"><span><i className="planned" aria-hidden="true" />Geplant</span><span><i className="completed" aria-hidden="true" />Erledigt (manuell markiert)</span><small>{monthEvents.filter((event) => event.kind === 'planned').length} geplant · {monthEvents.filter((event) => event.kind === 'completed').length} erledigt in diesem Monat</small></div>
    <div className="project-calendar-grid" role="group" aria-label={monthLabel(month)}>
      {weekdays.map((day) => <span className="project-calendar-weekday" key={day}>{day}</span>)}
      {days.map((day) => {
        const items = byDate.get(day.date) ?? [];
        const planned = items.filter((item) => item.kind === 'planned').length;
        const completed = items.length - planned;
        return <button key={day.date} type="button" className={`project-calendar-day${day.inMonth ? '' : ' is-adjacent'}${selected === day.date ? ' is-selected' : ''}${today === day.date ? ' is-today' : ''}`}
          aria-label={`${new Date(`${day.date}T12:00:00`).toLocaleDateString('de-DE', { dateStyle: 'full' })}: ${planned} geplant, ${completed} erledigt`}
          aria-pressed={selected === day.date} onClick={() => { setSelected(day.date); if (!day.inMonth) setMonth(new Date(`${day.date}T12:00:00`)); }}>
          <span className="project-calendar-day-number">{day.day}</span><span className="project-calendar-day-counts">{planned ? <span className="planned">{planned} geplant</span> : null}{completed ? <span className="completed">{completed} erledigt</span> : null}</span>
        </button>;
      })}
    </div>
    <section className="project-calendar-agenda" aria-label="Ausgewählter Tag"><h3>{new Date(`${selected}T12:00:00`).toLocaleDateString('de-DE', { dateStyle: 'full' })}</h3>
      {selectedEvents.length ? <ul>{selectedEvents.map((event) => <li key={event.id} className={`project-calendar-event is-${event.kind}`}><span>{event.kind === 'planned' ? 'Geplant' : 'Erledigt'}</span><button type="button" onClick={() => onOpenCard(event.cardId)}>{event.title}</button></li>)}</ul> : <p>Für diesen Tag liegen keine geplanten Termine oder markierten Abschlüsse vor.</p>}
    </section>
    {!events.length ? <p className="project-calendar-help">Noch keine Daten: Öffne eine Karte und setze unter „Termin und Abschluss“ ein geplantes Datum oder markiere ihren Abschluss.</p> : null}
  </section>;
}
