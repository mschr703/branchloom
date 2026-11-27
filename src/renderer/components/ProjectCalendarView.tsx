import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProjectSnapshot } from '../../shared/types';
import { calendarMonthDays, cardCalendarEvents, localDateKey, projectAgendaEvents } from '../calendar-model';
import './project-calendar.css';

const weekdays = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const monthLabel = (date: Date) => date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const AGENDA_PAGE_SIZE = 20;

export function ProjectCalendarView({ snapshot, onOpenCard }: { snapshot: ProjectSnapshot; onOpenCard: (cardId: string) => void }) {
  const today = localDateKey(new Date());
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [agendaScope, setAgendaScope] = useState<'month' | 'day'>('month');
  const [agendaPage, setAgendaPage] = useState(1);
  const events = useMemo(() => cardCalendarEvents(snapshot.cards), [snapshot.cards]);
  const agendaEvents = useMemo(() => projectAgendaEvents(snapshot.cards, snapshot.sessions ?? [], snapshot.agents ?? []), [snapshot.cards, snapshot.sessions, snapshot.agents]);
  const days = calendarMonthDays(month.getFullYear(), month.getMonth());
  const byDate = new Map<string, typeof events>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const monthPrefix = localDateKey(month).slice(0, 7);
  const monthEvents = events.filter((event) => event.date.startsWith(monthPrefix));
  const agenda = agendaEvents.filter((event) => agendaScope === 'month' ? event.date.startsWith(monthPrefix) : event.date === selected).reverse();
  const agendaPages = Math.max(1, Math.ceil(agenda.length / AGENDA_PAGE_SIZE));
  const currentPage = Math.min(agendaPage, agendaPages);
  const visibleAgenda = agenda.slice((currentPage - 1) * AGENDA_PAGE_SIZE, currentPage * AGENDA_PAGE_SIZE);
  const runStartsByDate = new Map<string, number>();
  for (const event of agendaEvents) if (event.kind === 'run-started') runStartsByDate.set(event.date, (runStartsByDate.get(event.date) ?? 0) + 1);

  function shiftMonth(step: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + step, 1);
    setMonth(next);
    setSelected(localDateKey(next));
    setAgendaScope('month');
    setAgendaPage(1);
  }

  return <section className="project-calendar standard-page" aria-label="Projektkalender">
    <header className="project-calendar-header"><div><h2>Kalender</h2><p>Geplante Termine, markierte Abschlüsse und aufgezeichnete Agentenläufe.</p></div>
      <div className="project-calendar-month-controls"><button type="button" className="icon-button" aria-label="Vorheriger Monat" onClick={() => shiftMonth(-1)}><ChevronLeft size={17} /></button><strong>{monthLabel(month)}</strong><button type="button" className="icon-button" aria-label="Nächster Monat" onClick={() => shiftMonth(1)}><ChevronRight size={17} /></button><button type="button" className="secondary-button small" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(localDateKey(now)); setAgendaScope('day'); setAgendaPage(1); }}>Heute</button></div>
    </header>
    <div className="project-calendar-legend"><span><i className="planned" aria-hidden="true" />Geplant</span><span><i className="completed" aria-hidden="true" />Erledigt (manuell markiert)</span><span><i className="run" aria-hidden="true" />Agentenlauf</span><small>{monthEvents.filter((event) => event.kind === 'planned').length} geplant · {monthEvents.filter((event) => event.kind === 'completed').length} erledigt · {agendaEvents.filter((event) => event.kind === 'run-started' && event.date.startsWith(monthPrefix)).length} Läufe in diesem Monat</small></div>
    <div className="project-calendar-grid" role="group" aria-label={monthLabel(month)}>
      {weekdays.map((day) => <span className="project-calendar-weekday" key={day}>{day}</span>)}
      {days.map((day) => {
        const items = byDate.get(day.date) ?? [];
        const planned = items.filter((item) => item.kind === 'planned').length;
        const completed = items.length - planned;
        const runs = runStartsByDate.get(day.date) ?? 0;
        return <button key={day.date} type="button" className={`project-calendar-day${day.inMonth ? '' : ' is-adjacent'}${selected === day.date && agendaScope === 'day' ? ' is-selected' : ''}${today === day.date ? ' is-today' : ''}`}
          aria-label={`${new Date(`${day.date}T12:00:00`).toLocaleDateString('de-DE', { dateStyle: 'full' })}: ${planned} geplant, ${completed} erledigt, ${runs} Agentenläufe`}
          aria-pressed={selected === day.date && agendaScope === 'day'} onClick={() => { setSelected(day.date); setAgendaScope('day'); setAgendaPage(1); if (!day.inMonth) setMonth(new Date(`${day.date}T12:00:00`)); }}>
          <span className="project-calendar-day-number">{day.day}</span><span className="project-calendar-day-counts">{planned ? <span className="planned">{planned} geplant</span> : null}{completed ? <span className="completed">{completed} erledigt</span> : null}{runs ? <span className="run">{runs} {runs === 1 ? 'Lauf' : 'Läufe'}</span> : null}</span>
        </button>;
      })}
    </div>
    <section className="project-calendar-agenda" aria-label="Kalenderagenda"><div className="project-calendar-agenda-head"><div><h3>Agenda</h3><p>{agendaScope === 'month' ? monthLabel(month) : new Date(`${selected}T12:00:00`).toLocaleDateString('de-DE', { dateStyle: 'full' })} · {agenda.length} Einträge</p></div><div className="project-calendar-agenda-scope" role="group" aria-label="Agenda-Zeitraum"><button type="button" aria-pressed={agendaScope === 'month'} onClick={() => { setAgendaScope('month'); setAgendaPage(1); }}>Monat</button><button type="button" aria-pressed={agendaScope === 'day'} onClick={() => { setAgendaScope('day'); setAgendaPage(1); }}>Tag</button></div></div>
      {visibleAgenda.length ? <ul>{visibleAgenda.map((event) => <li key={event.id} className={`project-calendar-event is-${event.kind}`}><time dateTime={event.time ? `${event.date}T${event.time}` : event.date}>{new Date(`${event.date}T12:00:00`).toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })}{event.time ? <small>{event.time}</small> : null}</time><span className="project-calendar-event-mark" aria-hidden="true" /><div><small>{event.detail}</small>{event.cardId ? <button type="button" onClick={() => onOpenCard(event.cardId!)}>{event.title}</button> : <strong>{event.title}</strong>}</div></li>)}</ul> : <p>Für diesen Zeitraum sind keine geplanten Termine, markierten Abschlüsse oder Agentenläufe gespeichert.</p>}
      {agendaPages > 1 ? <nav className="project-calendar-agenda-pages" aria-label="Agendaseiten"><button type="button" className="text-button" disabled={currentPage === 1} onClick={() => setAgendaPage(currentPage - 1)}>Zurück</button><span>Seite {currentPage} von {agendaPages}</span><button type="button" className="text-button" disabled={currentPage === agendaPages} onClick={() => setAgendaPage(currentPage + 1)}>Weiter</button></nav> : null}
    </section>
    {!agendaEvents.length ? <p className="project-calendar-help">Noch keine Daten: Öffne eine Karte und setze unter „Termin und Abschluss“ ein geplantes Datum, markiere ihren Abschluss oder starte einen Agentenlauf.</p> : null}
  </section>;
}
