import { useEffect, useState, type Ref } from 'react';
import type { BugReplayResult, BugScenario } from '../../shared/bug-replay';
import './card-bug-replay.css';

const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
const targetName = (target: BugScenario['expectation']['target']): string => `${target.kind === 'test-id' ? 'data-testid' : 'ID'} „${target.value}“`;
const yesNoUnknown = (value: boolean | null): string => value === null ? 'Unbekannt' : value ? 'Ja' : 'Nein';

export function CardBugReplayPanel({ cardId, archived, sectionRef }: { cardId: string; archived: boolean; sectionRef?: Ref<HTMLElement> }) {
  const [scenarios, setScenarios] = useState<BugScenario[]>([]);
  const [runs, setRuns] = useState<Record<string, BugReplayResult[]>>({});
  const [loading, setLoading] = useState(true);
  const [armed, setArmed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true); setArmed(null); setError('');
    void window.studio.bugScenarios(cardId).then(async (items) => {
      const saved = await Promise.all(items.map((item) => window.studio.bugScenarioRuns(item.id)));
      if (live) { setScenarios(items); setRuns(Object.fromEntries(items.map((item, index) => [item.id, saved[index]!]))); setLoading(false); }
    }).catch((reason: unknown) => { if (live) { setError(messageOf(reason)); setLoading(false); } });
    return () => { live = false; };
  }, [cardId]);

  async function run(scenarioId: string) {
    if (busy) return;
    if (armed !== scenarioId) { setArmed(scenarioId); return; }
    setBusy(scenarioId); setError('');
    try {
      const result = await window.studio.runBugScenario(scenarioId);
      setRuns((current) => ({ ...current, [scenarioId]: [result, ...(current[scenarioId] ?? [])].slice(0, 10) }));
      setArmed(null);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(null); }
  }

  return <section ref={sectionRef} className="card-bug-replay" aria-label="Gespeicherte Fehlerabläufe" tabIndex={-1}>
    <div className="section-heading"><h3>Fehlerabläufe</h3></div>
    <p className="section-copy">Im Browser aufgenommene lokale Klicks und markierte Größenwechsel liegen hier mit einer überprüfbaren Erwartung. Jeder neue Lauf braucht einen eigenen Klick und die zugehörige bereite Karten-Vorschau.</p>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {loading ? <p className="section-copy" role="status">Abläufe werden geladen…</p> : scenarios.length === 0 ? <p className="section-copy">Noch kein Ablauf. Öffne eine lokale Karten-Vorschau im Browser und wähle dort „Fehlerablauf aufnehmen“.</p> : scenarios.map((scenario) => <details key={scenario.id} className="card-bug-scenario">
      <summary><strong>{new URL(scenario.url).pathname === '/' ? 'Startseite (/)' : new URL(scenario.url).pathname}</strong><span>{scenario.actions.length} {scenario.actions.length === 1 ? 'Schritt' : 'Schritte'} · {new Date(scenario.createdAt).toLocaleString('de-DE')}</span></summary>
      <p>Start: {scenario.width} × {scenario.height} px · Erwartung: {targetName(scenario.expectation.target)} {scenario.expectation.state === 'visible' ? 'sichtbar' : 'verborgen'}.</p>
      <ol>{scenario.actions.map((step, index) => <li key={index}>{step.kind === 'click' ? `Klick auf ${targetName(step.target)}` : `Größe auf ${step.width} × ${step.height} px`}</li>)}</ol>
      <p>{scenario.diagnostics.length ? `${scenario.diagnostics.length} Fehlerhinweis${scenario.diagnostics.length === 1 ? '' : 'e'} während der Aufnahme: ${scenario.diagnostics.map((item) => `${item.category}${item.line ? ` (Zeile ${item.line})` : ''}`).join(', ')}.` : 'Keine zusätzlichen Konsolen- oder Ladefehler während der Aufnahme.'} Originalmeldungen wurden nicht gespeichert.</p>
      {armed === scenario.id ? <p className="card-bug-warning">Der Test klickt in einer neuen, isolierten lokalen Browser-Sitzung. Die Ziel-App kann dabei Testdaten schreiben. Prüfe den Dev-Server und starte nur mit dafür vorgesehenen Testdaten.</p> : null}
      <div className="card-bug-actions"><button className="secondary-button small" type="button" disabled={archived || Boolean(busy)} onClick={() => void run(scenario.id)}>{busy === scenario.id ? 'Prüft…' : armed === scenario.id ? 'Jetzt im Testsystem ausführen' : 'Prüfung vorbereiten'}</button>{armed === scenario.id ? <button className="text-button" type="button" onClick={() => setArmed(null)}>Abbrechen</button> : null}</div>
      {(runs[scenario.id] ?? []).length ? <ol className="card-bug-runs">{runs[scenario.id]!.map((result) => <li key={result.id}><strong className={result.status}>{result.status === 'passed' ? 'Erwartung erfüllt' : result.status === 'failed' ? 'Erwartung verfehlt' : 'Nicht prüfbar'}</strong><span>{new Date(result.checkedAt).toLocaleString('de-DE')} · {result.viewportWidth} × {result.viewportHeight} px</span><p>{result.observed}</p><details className="card-bug-evidence"><summary>Prüfbedingungen und Git-Belege</summary><dl><dt>Umgebungslauf</dt><dd><code>{result.environmentRunId}</code></dd><dt>Geprüfte Adresse</dt><dd><code>{result.requestedUrl}</code></dd><dt>Kartenrevision</dt><dd>{scenario.cardRevision}</dd><dt>Profil-Fingerprint</dt><dd><code>{scenario.environmentProfile}</code></dd><dt>Git-Quelle</dt><dd>{result.gitEvidence.scope === 'card-worktree' ? 'Karten-Worktree' : 'Projekt-Checkout'}</dd><dt>Git-Status</dt><dd>{result.gitEvidence.state}</dd><dt>HEAD vor / nach</dt><dd><code>{result.gitEvidence.startHead ?? 'Nicht ermittelbar'}</code> / <code>{result.gitEvidence.endHead ?? 'Nicht ermittelbar'}</code></dd><dt>Ungespeicherte Änderungen vor / nach</dt><dd>{yesNoUnknown(result.gitEvidence.dirtyAtStart)} / {yesNoUnknown(result.gitEvidence.dirtyAtEnd)}</dd></dl><p>Die ausgelieferte Seite ist keinem Commit sicher zugeordnet.</p></details></li>)}</ol> : <p className="section-copy">Noch kein Prüflauf gespeichert.</p>}
    </details>)}
  </section>;
}
