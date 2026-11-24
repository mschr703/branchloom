import { useEffect, useState } from 'react';
import type { Card } from '../../shared/types';
import type { IntegrationItem } from '../../shared/integration-queue';
import '../integration-queue.css';

interface Props { card: Card; cards: Card[]; onIntegrated: () => void }
const names: Record<IntegrationItem['state'], string> = {
  queued: 'Wartet', ready: 'Geprüft · Freigabe nötig', blocked: 'Blockiert', integrating: 'Git-Ausgang wird geprüft', integrated: 'Übernommen',
};

export function IntegrationQueuePanel({ card, cards, onIntegrated }: Props) {
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = items.find((item) => item.cardId === card.id);
  useEffect(() => {
    let active = true;
    setItems([]); setError(''); setLoading(true);
    void window.studio.integrationQueue(card.projectId)
      .then((result) => { if (active) setItems(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [card.id, card.projectId]);

  async function act(action: 'enqueue' | 'prepare' | 'approve') {
    if (busy) return;
    if (action === 'approve' && !window.confirm(`Die geprüften Commits von „${card.title}“ jetzt in ${current?.targetBranch ?? 'den Zielbranch'} übernehmen? Vor dem Fast-Forward werden Karte und Git-Basis erneut geprüft.`)) return;
    setBusy(true); setError('');
    try {
      if (action === 'enqueue') await window.studio.enqueueIntegration(card.id);
      else if (action === 'prepare') await window.studio.prepareIntegration(card.id);
      else { await window.studio.approveIntegration({ cardId: card.id, confirm: true }); onIntegrated(); }
      setItems(await window.studio.integrationQueue(card.projectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      try { setItems(await window.studio.integrationQueue(card.projectId)); } catch { /* Keep the visible last known state. */ }
    }
    finally { setBusy(false); }
  }

  return <section className="stacked-form" aria-label="Integrationswarteschlange">
    <h4>Integrationswarteschlange</h4>
    <p className="section-copy">Fertige Karten werden pro Repository und Zielbranch nacheinander übernommen. Dieser erste Ablauf wartet immer auf deine Freigabe; divergierte Git-Stände bleiben unangetastet.</p>
    {loading ? <p className="inline-note" role="status">Integrationsliste wird geladen…</p> : items.length ? <ol className="integration-queue-list">{items.map((entry, index) => <li key={entry.id} aria-current={entry.cardId === card.id ? 'true' : undefined}>
      <strong>{cards.find((candidate) => candidate.id === entry.cardId)?.title ?? 'Entfernte Karte'}</strong>
      <span>Platz {index + 1} · {names[entry.state]} · {entry.targetBranch} · <code title={entry.sourceHead}>{entry.sourceHead.slice(0, 8)}</code></span>
      {entry.reason ? <small>{entry.reason}</small> : null}
      {entry.integratedHead ? <small>Git-Ziel: <code title={entry.integratedHead}>{entry.integratedHead.slice(0, 12)}</code></small> : null}
    </li>)}</ol> : <p className="inline-note">Noch keine Karten zur Integration vorgemerkt.</p>}
    <div className="agent-actions">
      {!loading && (!current || current.state === 'integrated') ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void act('enqueue')}>Diese Karte vormerken</button> : null}
      {current && ['queued', 'ready', 'blocked'].includes(current.state) ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void act('prepare')}>Git-Stand neu prüfen</button> : null}
      {current?.state === 'ready' ? <button className="primary-button" type="button" disabled={busy} onClick={() => void act('approve')}>Geprüft übernehmen</button> : null}
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
