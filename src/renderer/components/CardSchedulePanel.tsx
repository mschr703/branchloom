import { useEffect, useState } from 'react';
import type { Card } from '../../shared/types';
import type { CardScheduleEvent } from '../../shared/card-schedule';
import type { Mutate } from './shared';
import './card-schedule-panel.css';

function eventDescription(event: CardScheduleEvent): string {
  if (event.kind === 'completion') return event.after ? 'Als erledigt markiert' : 'Abschluss zurückgenommen';
  if (!event.after) return `Geplantes Datum ${event.before} entfernt`;
  return event.before ? `Geplantes Datum von ${event.before} auf ${event.after} geändert` : `Geplant für ${event.after}`;
}

export function CardSchedulePanel({ card, mutate }: { card: Card; mutate: Mutate }) {
  const [draft, setDraft] = useState(card.plannedDueDate ?? '');
  const [events, setEvents] = useState<CardScheduleEvent[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { setDraft(card.plannedDueDate ?? ''); setError(''); }, [card.id, card.plannedDueDate]);
  useEffect(() => { setEvents([]); }, [card.id]);
  useEffect(() => {
    if (!expanded) return;
    let live = true;
    void window.studio.cardScheduleEvents(card.id).then((next) => { if (live) setEvents(next); })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { live = false; };
  }, [card.id, expanded]);

  async function refresh() {
    try { setEvents(await window.studio.cardScheduleEvents(card.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function saveDate() {
    setBusy(true); setError('');
    try {
      const saved = await mutate(() => window.studio.updateCard({ id: card.id, plannedDueDate: draft || null }));
      if (saved) await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function changeCompletion() {
    setBusy(true); setError('');
    try {
      const saved = await mutate(() => window.studio.setCardCompleted({ id: card.id, completed: !card.completedAt }));
      if (saved) await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <details className="card-detail-group card-schedule-panel" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>Termin und Abschluss{card.completedAt ? ' · Erledigt' : card.plannedDueDate ? ` · ${card.plannedDueDate}` : ''}</summary>
    <div className="card-detail-group-content">
      <p className="field-help">Geplantes Datum und tatsächlicher Abschluss sind getrennt. Das Verschieben in eine Spalte markiert die Karte nicht automatisch als erledigt.</p>
      <div className="card-schedule-controls">
        <label>Geplant bis<input type="date" value={draft} disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setDraft(event.target.value)} /></label>
        <button type="button" className="secondary-button small" disabled={busy || Boolean(card.archivedAt) || draft === (card.plannedDueDate ?? '')} onClick={() => void saveDate()}>Termin speichern</button>
      </div>
      <div className="card-schedule-completion">
        <span>{card.completedAt ? `Erledigt am ${new Date(card.completedAt).toLocaleString('de-DE')}` : 'Noch nicht als erledigt markiert'}</span>
        <button type="button" className="secondary-button small" disabled={busy || Boolean(card.archivedAt)} onClick={() => void changeCompletion()}>{card.completedAt ? 'Abschluss zurücknehmen' : 'Als erledigt markieren'}</button>
      </div>
      {events.length ? <details className="card-schedule-history"><summary>Änderungen ansehen · {events.length}{events.length === 100 ? '+' : ''}</summary><ol>{events.map((event) => <li key={event.id}><time dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleString('de-DE')}</time><span>{eventDescription(event)}</span></li>)}</ol></details> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  </details>;
}
