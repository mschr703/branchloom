import { useEffect, useState } from 'react';
import type { Card, ProjectQaCapture, ProjectQaCaptureIndex } from '../../shared/types';
import type { ProjectWireframeIndex, WireframeElement } from '../../shared/card-wireframe';
import type { DesignSelection } from '../../shared/design-inspection';

function MiniArtboard({ elements }: { elements: WireframeElement[] }) {
  return <span className="design-overview-artboard" aria-hidden="true"><span className="design-overview-artboard-stage">{elements.slice(0, 18).map((item) => <span key={item.id} className={`design-overview-shape kind-${item.kind}`} style={{ left: `${item.x / 9.6}%`, top: `${item.y / 6}%`, width: `${item.width / 9.6}%`, height: `${item.height / 6}%` }} />)}</span></span>;
}

function CaptureTile({ capture, card, onOpen, onUseReference }: { capture: ProjectQaCapture; card: Card | undefined; onOpen: () => void | Promise<void>; onUseReference: (image: string) => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let mounted = true;
    void window.studio.cardQaScreenshot({ cardId: capture.cardId, reportId: capture.id })
      .then((dataUrl) => { if (mounted) { if (dataUrl.startsWith('data:image/png;base64,')) setImage(dataUrl); else setError(true); } })
      .catch(() => { if (mounted) setError(true); });
    return () => { mounted = false; };
  }, [capture.cardId, capture.id]);
  let route = 'Lokale Vorschau';
  try { route = new URL(capture.requestedUrl).pathname || '/'; } catch { /* Legacy report without a valid URL. */ }
  const date = new Date(capture.endedAt);
  const when = Number.isNaN(date.getTime()) ? 'Zeit unbekannt' : new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  return <div className="design-overview-capture-tile"><button type="button" className="design-overview-capture" disabled={!card} onClick={() => void onOpen()} aria-label={`QA-Aufnahme zu „${card?.title ?? 'nicht verfügbarer Karte'}“ öffnen`}>
    <span className="design-overview-capture-image">{image ? <img src={image} alt={`Gespeicherte lokale Aufnahme der Route ${route}`} onError={() => { setImage(null); setError(true); }} /> : <span>{error ? 'Aufnahme nicht verfügbar' : 'Aufnahme laden…'}</span>}</span>
    <span className="design-overview-document-text"><strong>{card?.title ?? 'Karte nicht im Board'}</strong><small>{route} · {capture.viewportWidth} × {capture.viewportHeight}</small><span>{when} · QA {capture.status === 'passed' ? 'bestanden' : capture.status === 'failed' ? 'mit Befunden' : 'mit Fehler'}</span></span>
  </button><button type="button" className="design-overview-reference-action" disabled={!card || !image} onClick={() => { if (image) onUseReference(image); }}>Als Referenz im Editor öffnen</button></div>;
}

export function DesignProjectOverview({ cards, index, captures, selections, loading, error, captureLoading, captureError, onRetry, onRetryCaptures, onOpenDraft, onOpenQaCard, onOpenReference, onOpenPreview }: {
  cards: Card[]; index: ProjectWireframeIndex | null; captures: ProjectQaCaptureIndex | null; selections: DesignSelection[]; loading: boolean; error: string; captureLoading: boolean; captureError: string;
  onRetry: () => void; onRetryCaptures: () => void; onOpenDraft: (cardId?: string) => void; onOpenQaCard: (cardId: string) => void | Promise<void>; onOpenReference: (capture: ProjectQaCapture, image: string) => void; onOpenPreview: () => void;
}) {
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const hasCaptures = captureLoading || Boolean(captureError) || Boolean(captures?.items.length);
  return <div className="design-overview">
    <header className="design-overview-header"><p>Entwürfe und Aufnahmen aus diesem Projekt.</p><button type="button" className="primary-button" onClick={() => onOpenDraft()}>Entwurf öffnen</button></header>
    <div className={`design-overview-primary${hasCaptures ? ' has-captures' : ''}`}>
    {loading ? <p role="status">Gespeicherte Entwürfe werden geladen…</p> : error ? <p role="alert">Entwürfe konnten nicht geladen werden: {error} <button type="button" onClick={onRetry}>Erneut laden</button></p> : <section className="design-overview-section" aria-label="Gespeicherte Entwürfe">
      <div className="design-overview-section-heading"><h3>Entwürfe</h3><span>{index?.items.length ?? 0}{index?.moreAvailable ? '+' : ''} gespeichert</span></div>
      {index?.items.length ? <div className="design-overview-grid">{index.items.map((item) => {
        const card = cardById.get(item.cardId);
        return <button key={item.cardId} type="button" className="design-overview-document" onClick={() => onOpenDraft(item.cardId)} aria-label={`Entwurf „${item.title}“ zu „${card?.title ?? 'entfernter Aufgabe'}“ öffnen`}>
          <MiniArtboard elements={item.elements} />
          <span className="design-overview-document-text"><strong>{item.title}</strong><small>{card?.title ?? 'Aufgabe nicht mehr im Board'}</small><span>{item.approvedRevision === item.revision ? 'Für Agenten freigegeben' : 'Gespeichert, nicht freigegeben'} · Version {item.revision}</span></span>
        </button>;
      })}</div> : <p className="design-overview-empty">Noch kein Entwurf gespeichert. Du kannst einen Entwurf selbst beginnen oder in einer Aufgabe einen Agentenvorschlag anfordern.</p>}
      {index?.moreAvailable ? <p className="design-overview-note">Die neuesten 24 Entwürfe werden hier gezeigt. Ältere bleiben über ihre Aufgabe im Editor erreichbar.</p> : null}
    </section>}
    {hasCaptures ? <section className="design-overview-section" aria-label="Gespeicherte App-Aufnahmen">
      <div className="design-overview-section-heading"><h3>App-Aufnahmen</h3><span>{captures?.items.length ?? 0}{captures?.moreAvailable ? '+' : ''} aus Karten-QA</span></div>
      {captureLoading ? <p role="status">Aufnahmen werden geladen…</p> : captureError ? <p role="alert">Aufnahmen konnten nicht geladen werden: {captureError} <button type="button" onClick={onRetryCaptures}>Erneut laden</button></p> : <div className="design-overview-grid">{captures?.items.map((capture) => <CaptureTile key={capture.id} capture={capture} card={cardById.get(capture.cardId)} onOpen={() => onOpenQaCard(capture.cardId)} onUseReference={(image) => onOpenReference(capture, image)} />)}</div>}
      <p className="design-overview-note">Diese Bilder stammen aus einem gespeicherten lokalen Browsercheck. Sie sind weder ein bearbeitbarer Entwurf noch ein Beleg für den aktuellen Code-Stand.</p>
    </section> : null}
    </div>
    <section className="design-overview-section" aria-label="Belege aus laufender App"><div className="design-overview-section-heading"><h3>Laufende App</h3><button type="button" onClick={onOpenPreview}>Vorschau prüfen <span aria-hidden="true">↗</span></button></div>
      {selections.length ? <ul className="design-overview-evidence">{selections.slice(0, 3).map((selection) => <li key={selection.id}><code>{selection.selector}</code><span>{selection.sourceUrl}</span></li>)}</ul> : <p className="design-overview-empty">Noch kein Element aus einer lokalen Vorschau erfasst.</p>}
    </section>
  </div>;
}
