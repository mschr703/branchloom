import type { Card } from '../../shared/types';
import type { ProjectWireframeIndex, WireframeElement } from '../../shared/card-wireframe';
import type { DesignSelection } from '../../shared/design-inspection';

function MiniArtboard({ elements }: { elements: WireframeElement[] }) {
  return <span className="design-overview-artboard" aria-hidden="true">{elements.slice(0, 18).map((item) => <span key={item.id} className={`design-overview-shape kind-${item.kind}`} style={{ left: `${item.x / 9.6}%`, top: `${item.y / 6}%`, width: `${item.width / 9.6}%`, height: `${item.height / 6}%` }} />)}</span>;
}

export function DesignProjectOverview({ cards, index, selections, loading, error, onRetry, onOpenDraft, onOpenPreview }: {
  cards: Card[]; index: ProjectWireframeIndex | null; selections: DesignSelection[]; loading: boolean; error: string;
  onRetry: () => void; onOpenDraft: (cardId?: string) => void; onOpenPreview: () => void;
}) {
  const cardById = new Map(cards.map((card) => [card.id, card]));
  return <div className="design-overview">
    <header className="design-overview-header"><p>Gespeicherte Entwürfe und Belege aus der laufenden App. Eine Zeichnung ändert noch keinen Code.</p><button type="button" className="primary-button" onClick={() => onOpenDraft()}>Entwurf öffnen</button></header>
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
    <section className="design-overview-section" aria-label="Belege aus laufender App"><div className="design-overview-section-heading"><h3>Laufende App</h3><button type="button" onClick={onOpenPreview}>Vorschau prüfen <span aria-hidden="true">↗</span></button></div>
      {selections.length ? <ul className="design-overview-evidence">{selections.slice(0, 3).map((selection) => <li key={selection.id}><code>{selection.selector}</code><span>{selection.sourceUrl}</span></li>)}</ul> : <p className="design-overview-empty">Noch kein Element aus einer lokalen Vorschau erfasst.</p>}
    </section>
    <p className="design-overview-note">Ein Agentenlauf erscheint hier erst, wenn ein Designentwurf oder ein Beleg tatsächlich gespeichert wurde. Automatische Übernahme von Agentenentwürfen ist noch in Arbeit.</p>
  </div>;
}
