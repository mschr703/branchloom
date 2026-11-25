import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { Card, CardQaBatchResult, CardQaPageObservation, CardQaReport, CardQaViewport } from '../../shared/types';
import { CardQaComparison } from './CardQaComparison';
import { CardQaViewportMatrix } from './CardQaViewportMatrix';
import { CardQaFixCard } from './CardQaFixCard';
import { TeamReviewPanel } from './TeamReviewPanel';
import { qaGitLabel } from './qa-git-label';
import './card-qa.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const statusOf = (report: CardQaReport): string => report.status === 'passed'
  ? 'Keine Konsolen- oder Ladefehler gefunden'
  : report.status === 'failed' ? `${report.diagnostics.length} Fehler gefunden` : 'Prüfung nicht abgeschlossen';
const viewportOf = (report: CardQaReport): string => report.viewportWidth > 0 && report.viewportHeight > 0
  ? `${report.viewportWidth} × ${report.viewportHeight} px` : 'nicht erfasst';
const observationOf = (item: CardQaPageObservation): string => {
  if (item.kind === 'missing-title') return 'Kein Seitentitel im geladenen Dokument.';
  if (item.kind === 'missing-image-alt') return `${item.count} von ${item.scanned} geprüften Bildern ohne alt-Attribut. Ein leeres alt für dekorative Bilder zählt nicht als Fund.`;
  return `Dokument ist ${item.pixels} px breiter als der sichtbare Inhaltsbereich (${item.clientWidth} px).`;
};

function CardQaScreenshot({ cardId, reportId }: { cardId: string; reportId: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    if (busy) return;
    if (dataUrl) { setDataUrl(null); return; }
    setBusy(true); setError('');
    try { setDataUrl(await window.studio.cardQaScreenshot({ cardId, reportId })); }
    catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <div className="card-qa-screenshot">
    <button className="secondary-button small" type="button" disabled={busy} onClick={() => void open()}>{busy ? 'Lädt…' : dataUrl ? 'Screenshot schließen' : 'Screenshot ansehen'}</button>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {dataUrl ? <figure><img src={dataUrl} alt="Lokaler Screenshot der geprüften Seite" /><figcaption>Momentaufnahme dieser Route zum Prüfzeitpunkt. Kein Vorher/Nachher-Vergleich.</figcaption></figure> : null}
  </div>;
}

function CardQaReportItem({ card, report, initiallyOpen }: { card: Card; report: CardQaReport; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => { setOpen(initiallyOpen); }, [initiallyOpen]);
  return <details className="card-qa-report" id={"card-qa-report-" + report.id} tabIndex={-1} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span className={`card-qa-state ${report.status}`}>{statusOf(report)}</span>{report.pageObservations.length ? <span className="card-qa-observation-count">{report.pageObservations.length} Seitenhinweise</span> : null}<time dateTime={report.endedAt}>{new Date(report.endedAt).toLocaleString('de-DE')}</time><span className="card-qa-viewport">{viewportOf(report)}</span></summary>
    <p className="card-qa-source"><strong>Seite:</strong> {report.requestedUrl}{report.finalUrl && report.finalUrl !== report.requestedUrl ? <> · <strong>Geladen:</strong> {report.finalUrl}</> : null}</p>
    <p className="card-qa-source">{qaGitLabel(report)}. Dies ist nur der zugeordnete Checkout; welche Dateien der lokale Server ausgeliefert hat, ist nicht belegt.</p>
    {report.note ? <p className="inline-note">{report.note}</p> : null}
    {report.diagnostics.length ? <ol className="card-qa-findings">{report.diagnostics.map((item) => <li key={item.id}><strong>{item.kind === 'console' ? 'Konsole' : 'Laden'}:</strong> {item.message}{item.sourceUrl ? <small>{item.sourceUrl}{item.line ? `:${item.line}` : ''}</small> : null}</li>)}</ol> : null}
    <div className="card-qa-page-check"><strong>Seitenstruktur</strong>
      {report.pageCheck === 'not-run' ? <p>Für diesen Bericht nicht geprüft.</p> : report.pageCheck === 'unavailable' ? <p>Die drei DOM-Prüfungen waren nicht verfügbar.</p> : <>
        <p>Seitentitel, Bild-Alt-Attribute und Dokumentbreite am gewählten Viewport geprüft{report.pageCheck === 'partial' ? '; bei mehr als 200 Bildern nur die ersten 200' : ''}.</p>
        {report.pageObservations.length ? <ul>{report.pageObservations.map((item) => <li key={item.kind}>{observationOf(item)}</li>)}</ul> : <p>Bei diesen drei Prüfungen kein Hinweis.</p>}
      </>}
    </div>
    {open && report.screenshotAvailable ? <CardQaScreenshot cardId={card.id} reportId={report.id} /> : null}
    {open && report.screenshotAvailable ? <TeamReviewPanel card={card} report={report} /> : null}
    {open && report.status !== 'passed' ? <CardQaFixCard sourceCard={card} report={report} /> : null}
  </details>;
}

export function CardQaPanel({ card, focusReport }: { card: Card; focusReport?: { id: string; token: number } | null }) {
  const [url, setUrl] = useState('');
  const [extraRoutes, setExtraRoutes] = useState('');
  const [viewport, setViewport] = useState<CardQaViewport>('desktop');
  const [batchResult, setBatchResult] = useState<CardQaBatchResult | null>(null);
  const [reports, setReports] = useState<CardQaReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showLatest, setShowLatest] = useState(false);
  const focusedToken = useRef<number | null>(null);

  useEffect(() => { setShowLatest(false); focusedToken.current = null; }, [card.id, focusReport?.token]);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(''); setReports([]); setUrl(''); setExtraRoutes(''); setViewport('desktop'); setBatchResult(null);
    void window.studio.cardQaReports(card.id).then((items) => {
      if (!alive) return;
      setReports(items); setLoading(false);
      setUrl((current) => current || items[0]?.requestedUrl || '');
    }).catch((reason: unknown) => { if (alive) { setError(messageOf(reason)); setLoading(false); } });
    return () => { alive = false; };
  }, [card.id]);

  useLayoutEffect(() => {
    if (loading || !focusReport || showLatest || focusedToken.current === focusReport.token || !reports.some((item) => item.id === focusReport.id)) return;
    const target = document.getElementById(`card-qa-report-${focusReport.id}`);
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
    focusedToken.current = focusReport.token;
  }, [loading, reports, showLatest, focusReport?.id, focusReport?.token]);

  async function run(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || card.archivedAt) return;
    const additional = extraRoutes.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (additional.length > 4) { setError('Gib höchstens vier weitere Routen ein.'); return; }
    setBusy(true); setError(''); setBatchResult(null);
    try {
      if (additional.length) {
        const result = await window.studio.runCardQaBatch({ cardId: card.id, urls: [url, ...additional], viewport });
        setBatchResult(result);
        setReports(await window.studio.cardQaReports(card.id));
        if (result.reports.length) setShowLatest(true);
      } else {
        const report = await window.studio.runCardQa({ cardId: card.id, url, viewport });
        setReports((items) => [report, ...items.filter((item) => item.id !== report.id)].slice(0, 20));
        setShowLatest(true);
      }
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  }

  return <section className="card-qa" aria-label="Lokale Browser-QA">
    <div className="section-heading"><FlaskConical size={19} aria-hidden="true" /><h3>Lokale Browser-QA</h3></div>
    <p className="section-copy">Prüft nach deinem Klick eine bis fünf lokale Dev-Server-Routen nacheinander, jede in einem frischen, isolierten Browser. Fremde Anfragen, Pop-ups und Berechtigungen werden blockiert. Es startet kein Agent.</p>
    <form className="card-qa-form" onSubmit={(event) => void run(event)}>
      <label>Vorschau-URL<input type="url" value={url} required maxLength={2048} disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setUrl(event.target.value)} placeholder="http://127.0.0.1:5173/" /></label>
      <label>Weitere Routen, optional<textarea rows={3} value={extraRoutes} maxLength={8195} disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setExtraRoutes(event.target.value)} placeholder={'http://127.0.0.1:5173/settings\nhttp://127.0.0.1:5173/profile'} /><small>Eine vollständige lokale URL pro Zeile, höchstens vier. Die Prüfung läuft in dieser Reihenfolge.</small></label>
      <label>Prüfgröße<select value={viewport} disabled={busy || Boolean(card.archivedAt)} onChange={(event) => setViewport(event.target.value as CardQaViewport)}><option value="desktop">Desktop · 1280 × 800</option><option value="tablet">Tablet · 768 × 1024</option><option value="mobile">Mobile · 390 × 844</option></select></label>
      <button className="secondary-button" type="submit" disabled={busy || Boolean(card.archivedAt) || !url.trim()}>{busy ? 'Prüft…' : extraRoutes.trim() ? 'Lokale Routen prüfen' : 'Lokale Seite prüfen'}</button>
    </form>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {batchResult ? <p className="inline-note" role="status">{batchResult.reports.length} von {batchResult.requested} Routen gespeichert · {batchResult.reports.filter((item) => item.status === 'passed').length} ohne erfasste Fehler · {batchResult.reports.filter((item) => item.status === 'failed').length} mit Fehlern · {batchResult.reports.filter((item) => item.status === 'error').length} nicht abgeschlossen.{batchResult.error ? ` Lauf vorzeitig beendet: ${batchResult.error}` : ''}</p> : null}
    {!loading && !showLatest && focusReport && !reports.some((item) => item.id === focusReport.id) ? <p className="inline-note" role="status">Dieser QA-Bericht ist nicht mehr gespeichert.</p> : null}
    {loading ? <p className="section-copy" role="status">Gespeicherte Prüfungen werden geladen…</p> : reports.length === 0 ? <p className="section-copy">Für diese Karte liegt noch kein Browser-QA-Bericht vor.</p> : <div className="card-qa-reports">
      {reports.map((report) => <CardQaReportItem key={report.id} card={card} report={report} initiallyOpen={report.id === (showLatest ? reports[0]?.id : focusReport?.id ?? reports[0]?.id)} />)}
    </div>}
    {!loading ? <CardQaComparison cardId={card.id} reports={reports} /> : null}
    {!loading ? <CardQaViewportMatrix cardId={card.id} reports={reports} /> : null}
    <p className="card-qa-limit">Der Bericht belegt diesen Seitenaufruf, Lade-/Konsolenfehler und bis zu drei einfache DOM-Beobachtungen bei der gewählten Größe. Interaktionen, vollständiges Layout und Barrierefreiheit bleiben separat zu prüfen.</p>
  </section>;
}
