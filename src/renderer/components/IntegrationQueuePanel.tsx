import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../shared/types';
import type { IntegrationItem, IntegrationPolicy } from '../../shared/integration-queue';
import type { IntegrationEvidence } from '../../shared/integration-evidence';
import { IntegrationResultFolder } from './IntegrationResultFolder';
import '../integration-queue.css';

interface Props { card: Card; cards: Card[]; onIntegrated: () => void; onOpenDiff: () => void }
const names: Record<IntegrationItem['state'], string> = {
  queued: 'Wartet', ready: 'Geprüft · Freigabe nötig', blocked: 'Blockiert', integrating: 'Git-Ausgang wird geprüft', integrated: 'Übernommen',
};
const testNames = { running: 'Läuft', passed: 'Bestanden', failed: 'Fehlgeschlagen', interrupted: 'Unterbrochen', stale: 'Ungültig' } as const;

export function IntegrationQueuePanel({ card, cards, onIntegrated, onOpenDiff }: Props) {
  const [items, setItems] = useState<IntegrationItem[]>([]);
  const [evidence, setEvidence] = useState<IntegrationEvidence | null>(null);
  const [policy, setPolicy] = useState<IntegrationPolicy | null>(null);
  const [scriptDraft, setScriptDraft] = useState('');
  const [diffOpened, setDiffOpened] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const previousState = useRef<{ cardId: string; state: IntegrationItem['state'] | null } | null>(null);
  const current = items.find((item) => item.cardId === card.id);
  useEffect(() => {
    const prior = previousState.current;
    const state = current?.state ?? null;
    previousState.current = { cardId: card.id, state };
    if (prior?.cardId === card.id && prior.state && prior.state !== 'integrated' && state === 'integrated') onIntegrated();
  }, [card.id, current?.state]);
  useEffect(() => {
    let active = true;
    setItems([]); setEvidence(null); setPolicy(null); setDiffOpened(false); setError(''); setLoading(true);
    void Promise.all([window.studio.integrationQueue(card.projectId), window.studio.integrationEvidence(card.id), window.studio.integrationPolicy(card.projectId)])
      .then(([result, proof, projectPolicy]) => { if (active) { setItems(result); setEvidence(proof); setPolicy(projectPolicy); setScriptDraft(proof.configuredScript ?? ''); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [card.id, card.projectId]);

  async function reload() {
    const [list, proof, projectPolicy] = await Promise.all([window.studio.integrationQueue(card.projectId), window.studio.integrationEvidence(card.id), window.studio.integrationPolicy(card.projectId)]);
    setItems(list); setEvidence(proof); setPolicy(projectPolicy);
  }

  useEffect(() => {
    if (policy?.mode !== 'automatic') return;
    let active = true;
    const timer = window.setInterval(() => {
      void Promise.all([window.studio.integrationQueue(card.projectId), window.studio.integrationEvidence(card.id)])
        .then(([list, proof]) => { if (active) { setItems(list); setEvidence(proof); } })
        .catch(() => { /* The next manual refresh reports a persistent error. */ });
    }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [card.id, card.projectId, policy?.mode]);

  async function changePolicy(mode: IntegrationPolicy['mode']) {
    if (busy) return;
    if (mode === 'automatic' && !window.confirm('Für dieses Projekt automatisch fast-forward integrieren, sobald die aktuelle Diff-Prüfung und der konfigurierte npm-Test bestanden sind? Branchloom prüft Karte, Git-Ziel und Belege unmittelbar vor jedem Merge erneut.')) return;
    setBusy(true); setError('');
    try { setPolicy(await window.studio.setIntegrationPolicy({ projectId: card.projectId, mode, confirm: mode === 'automatic' })); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function act(action: 'enqueue' | 'prepare' | 'review' | 'test' | 'approve' | 'script') {
    if (busy) return;
    if (action === 'approve' && !window.confirm(`Die geprüften Commits von „${card.title}“ jetzt in ${current?.targetBranch ?? 'den Zielbranch'} übernehmen? Vor dem Fast-Forward werden Karte und Git-Basis erneut geprüft.`)) return;
    if (action === 'review' && !window.confirm(`Hast du den Diff für ${current?.sourceHead.slice(0, 12)} gegen ${current?.targetHead.slice(0, 12)} geprüft? Die Bestätigung gilt nur für diese beiden Commits und die aktuelle Karte.`)) return;
    if (action === 'test' && !window.confirm(`„npm run ${evidence?.configuredScript}“ in einem temporären Checkout ausführen? Das Skript stammt aus dem Projekt und kann lokalen Code ausführen. Zeitlimit: 3 Minuten.`)) return;
    if (action === 'script' && evidence?.configuredScript && !scriptDraft.trim() && !window.confirm('Den konfigurierten Integrationstest für dieses Projekt entfernen? Künftige manuelle Übernahmen verlangen dann nur die ausdrückliche Diff-Prüfung.')) return;
    setBusy(true); setError('');
    try {
      if (action === 'enqueue') await window.studio.enqueueIntegration(card.id);
      else if (action === 'prepare') await window.studio.prepareIntegration(card.id);
      else if (action === 'review') await window.studio.attestIntegrationReview({ cardId: card.id, confirm: true });
      else if (action === 'test') await window.studio.runIntegrationTest(card.id);
      else if (action === 'script') await window.studio.setIntegrationTestScript({ projectId: card.projectId, scriptName: scriptDraft });
      else await window.studio.approveIntegration({ cardId: card.id, confirm: true });
      await reload();
      if (action === 'prepare') setDiffOpened(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      try { await reload(); } catch { /* Keep the visible last known state. */ }
    }
    finally { setBusy(false); }
  }

  return <section className="stacked-form" aria-label="Integrationswarteschlange">
    <h4>Integrationswarteschlange</h4>
    <p className="section-copy">Fertige Karten werden pro Repository und Zielbranch nacheinander übernommen. Divergierte Git-Stände bleiben unangetastet.</p>
    <div className="integration-policy">
      <label><input type="checkbox" checked={policy?.mode === 'automatic'} disabled={busy || !policy || (!evidence?.configuredScript && policy.mode !== 'automatic')} onChange={(event) => void changePolicy(event.target.checked ? 'automatic' : 'manual')} /> Nach aktuellen Belegen automatisch übernehmen</label>
      <small>Projektweit, standardmäßig aus. Automatik verlangt einen ausdrücklich geprüften Diff und einen aktuellen bestandenen npm-Test. Sie startet weder Tests noch löst sie Konflikte. Eine frühere Karte oder sichere Projektpause hält sie an.</small>
      {!evidence?.configuredScript && policy?.mode !== 'automatic' ? <small>Richte zuerst unten ein Integrationstest-Skript ein.</small> : null}
    </div>
    {loading ? <p className="inline-note" role="status">Integrationsliste wird geladen…</p> : items.length ? <ol className="integration-queue-list">{items.map((entry, index) => <li key={entry.id} aria-current={entry.cardId === card.id ? 'true' : undefined}>
      <strong>{cards.find((candidate) => candidate.id === entry.cardId)?.title ?? 'Entfernte Karte'}</strong>
      <span>Platz {index + 1} · {entry.state === 'ready' && policy?.mode === 'automatic' ? 'Automatik prüft' : names[entry.state]} · {entry.targetBranch} · <code title={entry.sourceHead}>{entry.sourceHead.slice(0, 8)}</code>{entry.state === 'integrated' && entry.approvalMode ? ` · ${entry.approvalMode === 'automatic' ? 'automatisch' : 'manuell'}` : ''}</span>
      {entry.reason ? <small>{entry.reason}</small> : null}
      {entry.integratedHead ? <small>Git-Ziel: <code title={entry.integratedHead}>{entry.integratedHead.slice(0, 12)}</code></small> : null}
    </li>)}</ol> : <p className="inline-note">Noch keine Karten zur Integration vorgemerkt.</p>}
    {!loading && items.length ? <IntegrationResultFolder projectId={card.projectId} queueRevision={items.map((entry) => `${entry.id}:${entry.state}:${entry.updatedAt}`).join('|')} /> : null}
    <div className="agent-actions">
      {!loading && (!current || current.state === 'integrated') ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void act('enqueue')}>Diese Karte vormerken</button> : null}
      {current && ['queued', 'ready', 'blocked'].includes(current.state) ? <button className="secondary-button" type="button" disabled={busy} onClick={() => void act('prepare')}>Git-Stand neu prüfen</button> : null}
      {current?.state === 'ready' ? <button className="secondary-button" type="button" disabled={busy} onClick={() => { onOpenDiff(); setDiffOpened(true); }}>Diff öffnen</button> : null}
      {current?.state === 'ready' && !evidence?.review?.current ? <button className="secondary-button" type="button" disabled={busy || !diffOpened} onClick={() => void act('review')}>Diff geprüft bestätigen</button> : null}
      {current?.state === 'ready' ? <button className="primary-button" type="button" disabled={busy || !evidence?.review?.current || evidence.test?.state === 'running' || Boolean(evidence.configuredScript && (evidence.test?.state !== 'passed' || !evidence.test.current))} onClick={() => void act('approve')}>Geprüft übernehmen</button> : null}
    </div>
    {current && current.state !== 'integrated' ? <div className="integration-checks">
      <label>Integrationstest des Projekts <span>npm run</span><input value={scriptDraft} maxLength={64} disabled={busy} onChange={(event) => setScriptDraft(event.target.value)} placeholder="test" /></label>
      <button type="button" className="text-button" disabled={busy || scriptDraft.trim() === (evidence?.configuredScript ?? '')} onClick={() => void act('script')}>Testskript speichern</button>
      <small>Nur ein Skriptname aus dem package.json des vorbereiteten Commits. Der Test läuft nach Bestätigung im temporären Checkout mit deinen lokalen Benutzerrechten.</small>
      {policy?.mode === 'automatic' && current.state === 'ready' ? <p className="section-copy" role="status">Automatik: {current.reason ?? (evidence?.review?.current && evidence.test?.state === 'passed' && evidence.test.current ? 'beide Belege aktuell; Fast-Forward wird geprüft' : 'wartet auf aktuellen Diff- und Testbeleg')}.</p> : null}
      {current.state === 'ready' && evidence?.configuredScript ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act('test')}>{busy ? 'Prüfung läuft…' : `npm run ${evidence.configuredScript} prüfen`}</button> : null}
      {evidence?.test ? <p className="section-copy" role="status">Test: {testNames[evidence.test.state]}{evidence.test.current ? '' : ' · veraltet'} · Quelle <code title={evidence.test.sourceHead}>{evidence.test.sourceHead.slice(0, 8)}</code> · Ziel <code title={evidence.test.targetHead}>{evidence.test.targetHead.slice(0, 8)}</code></p> : null}
      {evidence?.test?.outputTail ? <details><summary>Testausgabe ansehen</summary><pre className="terminal-output">{evidence.test.outputTail}</pre></details> : null}
      {evidence?.review ? <p className="section-copy">Diff-Prüfung: {evidence.review.current ? 'aktuell' : 'veraltet'} · {new Date(evidence.review.reviewedAt).toLocaleString('de-DE')}</p> : null}
    </div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
