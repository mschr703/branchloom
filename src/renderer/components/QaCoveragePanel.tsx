import { useEffect, useRef, useState } from 'react';
import { ScanSearch } from 'lucide-react';
import type { CardQaViewport, ProjectSnapshot } from '../../shared/types';
import type { QaCoverageRoute } from '../../shared/qa-coverage';
import { QaCoverageProjectGate } from '../qa-coverage-gate';
import './qa-coverage.css';

const sizes: { id: CardQaViewport; label: string }[] = [
  { id: 'desktop', label: 'Desktop' }, { id: 'tablet', label: 'Tablet' }, { id: 'mobile', label: 'Mobile' },
];
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);

function reportLabel(status: 'passed' | 'failed' | 'error'): string {
  return status === 'passed' ? 'Keine Konsolen-/Ladefehler' : status === 'failed' ? 'Fehler gefunden' : 'Nicht abgeschlossen';
}

export function QaCoveragePanel({ snapshot, onOpenQaReport }: { snapshot: ProjectSnapshot; onOpenQaReport: (cardId: string, reportId: string) => void }) {
  const projectId = snapshot.project.id;
  const gate = useRef(new QaCoverageProjectGate(projectId));
  gate.current.enter(projectId);
  const cards = snapshot.cards.filter((card) => !card.archivedAt);
  const [open, setOpen] = useState(false);
  const [routes, setRoutes] = useState<QaCoverageRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cardId, setCardId] = useState('');
  const [url, setUrl] = useState('');
  const [viewports, setViewports] = useState<CardQaViewport[]>(['desktop']);

  useEffect(() => { setOpen(false); setRoutes([]); setCardId(''); setUrl(''); setViewports(['desktop']); setError(''); setNotice(''); setBusy(''); setLoading(false); }, [projectId]);

  async function reload() {
    const ticket = gate.current.begin();
    setLoading(true); setError('');
    try { const items = await window.studio.qaCoverageRoutes(projectId); if (gate.current.isCurrent(ticket)) setRoutes(items); }
    catch (reason) { if (gate.current.isCurrent(ticket)) setError(messageOf(reason)); }
    finally { if (gate.current.isCurrent(ticket)) setLoading(false); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const ticket = gate.current.begin();
    setLoading(false); setBusy('save'); setError(''); setNotice('');
    try {
      await window.studio.saveQaCoverageRoute({ projectId, cardId, url, viewports });
      const items = await window.studio.qaCoverageRoutes(projectId);
      if (gate.current.isCurrent(ticket)) { setRoutes(items); setNotice('Route und Prüfgrößen gespeichert. Ein QA-Lauf startet erst nach deinem Klick auf eine Zelle.'); }
    } catch (reason) { if (gate.current.isCurrent(ticket)) setError(messageOf(reason)); }
    finally { if (gate.current.isCurrent(ticket)) setBusy(''); }
  }

  async function remove(routeId: string) {
    if (busy) return;
    const ticket = gate.current.begin();
    setLoading(false); setBusy(routeId); setError(''); setNotice('');
    try {
      await window.studio.removeQaCoverageRoute({ projectId, routeId });
      const items = await window.studio.qaCoverageRoutes(projectId);
      if (gate.current.isCurrent(ticket)) { setRoutes(items); setNotice('Route entfernt. Gespeicherte Karten-QA-Berichte bleiben erhalten.'); }
    } catch (reason) { if (gate.current.isCurrent(ticket)) setError(messageOf(reason)); }
    finally { if (gate.current.isCurrent(ticket)) setBusy(''); }
  }

  async function run(routeId: string, viewport: CardQaViewport) {
    if (busy) return;
    const ticket = gate.current.begin();
    setLoading(false); setBusy(`${routeId}:${viewport}`); setError(''); setNotice('');
    try {
      const report = await window.studio.runQaCoverageCell({ projectId, routeId, viewport });
      const items = await window.studio.qaCoverageRoutes(projectId);
      if (gate.current.isCurrent(ticket)) { setRoutes(items); setNotice(`QA-Bericht gespeichert: ${reportLabel(report.status)}. Öffne den Bericht für die Einzelheiten.`); }
    } catch (reason) { if (gate.current.isCurrent(ticket)) setError(messageOf(reason)); }
    finally { if (gate.current.isCurrent(ticket)) setBusy(''); }
  }

  return <details className="qa-coverage" data-project-id={projectId} open={open} onToggle={(event) => {
    if (event.currentTarget.open === open) return;
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open && !busy) void reload();
  }}>
    <summary title="Ausgewählte Routen und QA-Berichte"><ScanSearch size={15} aria-hidden="true" /> UI-Prüfung</summary>
    <div className="qa-coverage-body">
      <div className="qa-coverage-intro"><p>Nur bewusst gewählte Karten, Routen und Größen. Jede Zelle zeigt den jüngsten gespeicherten QA-Bericht dieser Kombination; „veraltet“ bedeutet älter als sieben Tage. Keine Aussage über andere Seiten oder Zustände.</p><button className="secondary-button small" type="button" disabled={loading || Boolean(busy)} onClick={() => void reload()}>Berichte aktualisieren</button></div>
      <form className="qa-coverage-form" onSubmit={(event) => void save(event)}>
        <label>Karte<select value={cardId} required disabled={Boolean(busy)} onChange={(event) => setCardId(event.target.value)}><option value="">Karte wählen</option>{cards.map((card) => <option key={card.id} value={card.id}>{card.title}</option>)}</select></label>
        <label>Lokale Route<input type="url" value={url} required maxLength={500} disabled={Boolean(busy)} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:5173/" /></label>
        <fieldset><legend>Prüfgrößen</legend>{sizes.map((size) => <label key={size.id}><input type="checkbox" checked={viewports.includes(size.id)} disabled={Boolean(busy)} onChange={(event) => setViewports((current) => event.target.checked ? [...current, size.id] : current.filter((item) => item !== size.id))} />{size.label}</label>)}</fieldset>
        <button className="secondary-button" type="submit" disabled={Boolean(busy) || !cardId || !url.trim() || !viewports.length}>Route merken</button>
      </form>
      <p className="qa-coverage-hint">Bis zu acht Routen je Projekt. Dieselbe Karte und Route erneut speichern, um die Größen zu ändern.</p>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      {notice ? <p className="inline-note" role="status">{notice}</p> : null}
      {loading ? <p role="status">Lade ausgewählte Routen…</p> : routes.length === 0 ? <p className="qa-coverage-empty">Noch keine Route ausgewählt.</p> : <div className="qa-coverage-scroll"><table><caption className="sr-only">Ausgewählte UI-Routen und lokale QA-Berichte nach Prüfgröße</caption><thead><tr><th scope="col">Route und Karte</th>{sizes.map((size) => <th scope="col" key={size.id}>{size.label}</th>)}<th scope="col">Auswahl</th></tr></thead><tbody>{routes.map((route) => {
        const card = snapshot.cards.find((item) => item.id === route.cardId);
        return <tr key={route.id}><th scope="row"><span className="qa-coverage-route">{route.url}</span><small>{card?.title ?? 'Karte fehlt'}{card?.archivedAt ? ' · archiviert' : ''}</small></th>{sizes.map((size) => {
          const cell = route.cells.find((item) => item.viewport === size.id);
          if (!cell) return <td key={size.id}><span className="qa-coverage-unselected">Nicht gewählt</span></td>;
          return <td key={size.id}><div className="qa-coverage-cell"><strong className={cell.report?.status === 'failed' || cell.report?.status === 'error' ? 'qa-coverage-failed' : ''}>{cell.state === 'missing' ? 'Kein Bericht' : cell.state === 'stale' ? 'Veraltet' : reportLabel(cell.report!.status)}</strong>{cell.report ? <><time dateTime={cell.report.endedAt}>{new Date(cell.report.endedAt).toLocaleString('de-DE')}</time>{cell.state === 'stale' ? <small>{reportLabel(cell.report.status)}</small> : null}{cell.report.observationCount ? <small>{cell.report.observationCount} DOM-Hinweise</small> : cell.report.pageCheck !== 'complete' ? <small>DOM-Prüfung {cell.report.pageCheck === 'partial' ? 'teilweise' : 'nicht verfügbar'}</small> : null}<button className="text-button" type="button" onClick={() => onOpenQaReport(cell.report!.cardId, cell.report!.id)}>Bericht öffnen</button></> : null}<button className="secondary-button small" type="button" disabled={Boolean(busy) || Boolean(card?.archivedAt) || !card} onClick={() => void run(route.id, size.id)}>{busy === `${route.id}:${size.id}` ? 'Prüft…' : 'Jetzt prüfen'}</button></div></td>;
        })}<td><div className="qa-coverage-actions"><button className="text-button" type="button" disabled={Boolean(busy) || Boolean(card?.archivedAt)} onClick={() => { setCardId(route.cardId); setUrl(route.url); setViewports(route.viewports); }}>Größen bearbeiten</button><button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => void remove(route.id)}>Entfernen</button></div></td></tr>;
      })}</tbody></table></div>}
    </div>
  </details>;
}
