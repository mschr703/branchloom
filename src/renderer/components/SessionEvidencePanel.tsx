import { useEffect, useRef, useState } from 'react';
import type { CardQaReport, Session } from '../../shared/types';
import type { RunSource, SessionRunEvidence } from '../../shared/session-evidence';
import './session-evidence.css';

const sourceLabel: Record<RunSource, string> = {
  'card-text': 'Kartentitel und Beschreibung',
  'manual-prompt': 'Manuell eingegebener Auftrag',
  'approved-wireframe': 'Freigegebener Kartenentwurf',
  'api-contract': 'Freigegebener API-Vertrag',
  'component-reference': 'Ausgewählte Komponentenreferenzen',
  'codex-resume-id': 'Gespeicherte Codex-Gesprächs-ID',
  'codex-resume-picker': 'Codex-Gesprächsauswahl im Terminal',
};
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function SessionEvidencePanel({ sessions, archived, onOpenQa }: { sessions: Session[]; archived: boolean; onOpenQa: (reportId: string) => void }) {
  const [selectedSessionId, setSelectedSessionId] = useState(sessions[0]!.id);
  const session = sessions.find((item) => item.id === selectedSessionId) ?? sessions[0]!;
  const currentSessionId = useRef(session.id);
  currentSessionId.current = session.id;
  const [evidence, setEvidence] = useState<SessionRunEvidence | null>(null);
  const [reports, setReports] = useState<CardQaReport[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setSelectedSessionId(sessions[0]!.id); }, [sessions[0]?.id]);

  async function refresh() {
    const requestSessionId = session.id;
    const [run, qa] = await Promise.all([
      window.studio.sessionRunEvidence({ projectId: session.projectId, sessionId: session.id }),
      window.studio.cardQaReports(session.cardId),
    ]);
    if (currentSessionId.current === requestSessionId) { setEvidence(run); setReports(qa); }
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setBusy(false); setError(''); setEvidence(null); setReports([]); setSelected('');
    void Promise.all([window.studio.sessionRunEvidence({ projectId: session.projectId, sessionId: session.id }), window.studio.cardQaReports(session.cardId)])
      .then(([run, qa]) => { if (active) { setEvidence(run); setReports(qa); setLoading(false); } })
      .catch((reason) => { if (active) { setError(errorText(reason)); setLoading(false); } });
    return () => { active = false; };
  }, [session.id, session.projectId, session.cardId]);

  async function apply(action: () => Promise<SessionRunEvidence>) {
    if (busy) return;
    const requestSessionId = session.id;
    setBusy(true); setError('');
    try { const result = await action(); if (currentSessionId.current === requestSessionId) { setEvidence(result); setSelected(''); } }
    catch (reason) { if (currentSessionId.current === requestSessionId) setError(errorText(reason)); }
    finally { if (currentSessionId.current === requestSessionId) setBusy(false); }
  }

  const linked = new Set(evidence?.linkedQa.map((item) => item.reportId) ?? []);
  const available = archived ? [] : reports.filter((item) => item.startedAt >= session.startedAt && !linked.has(item.id));
  const launch = evidence?.launch;
  return <details className="session-evidence">
    <summary>Laufbeleg <span>{evidence?.linkedQa.length ?? 0} zugeordnete Browser-QA</span></summary>
    <div className="session-evidence-body">
      <p>Lokale Startdaten und bewusst zugeordnete Prüfberichte. Ein gestarteter Prozess oder QA-Bericht beweist keine Modellantwort und keine abgeschlossene Kartenaufgabe.</p>
      <label className="session-evidence-select">Agentenlauf<select value={session.id} onChange={(event) => setSelectedSessionId(event.target.value)}>{sessions.map((item) => <option key={item.id} value={item.id}>{new Date(item.startedAt).toLocaleString('de-DE')} · {item.state}</option>)}</select></label>
      {loading ? <p role="status">Laufbeleg wird geladen…</p> : launch ? <><dl className="session-evidence-facts">
        <div><dt>Agent beim Start</dt><dd>{launch.agentName} · {launch.agentKind}</dd></div>
        <div><dt>CLI-Version</dt><dd>{launch.versionCheck === 'ready' ? launch.version ?? 'Prüfung erfolgreich, keine Versionsangabe' : launch.versionCheck === 'timeout' ? 'Versionsprüfung: Zeitlimit' : launch.versionCheck === 'error' ? 'Versionsprüfung fehlgeschlagen' : 'Nicht geprüft'}</dd></div>
        <div><dt>Startmodus</dt><dd>{launch.mode === 'one-shot' ? 'Einzelschritt' : launch.mode === 'resume' ? 'Codex fortsetzen' : 'Interaktiv'} · {launch.promptDelivery === 'argv' ? 'Starttext beim Prozessstart als CLI-Argument übergeben' : launch.promptDelivery === 'pty-written' ? 'Starttext ans lokale PTY geschrieben; CLI-Empfang ungeprüft' : launch.promptDelivery === 'pty-delayed' ? 'Verzögerte PTY-Eingabe vorgesehen; Zustellung ungeprüft' : launch.promptDelivery === 'resume' ? 'Alter Auftrag nicht erneut gesendet' : launch.promptDelivery === 'none' ? 'Kein Starttext übergeben' : 'Promptübergabe ungeprüft'}</dd></div>
        <div><dt>Konfiguration</dt><dd>Modell: {launch.configuredModel ?? 'CLI-/Profilstandard, nicht ermittelt'} · Effort: {launch.configuredEffort ?? 'Standard, nicht ermittelt'} · {launch.profileArgumentCount} Profilargumente (Inhalt hier nicht gespeichert)</dd></div>
        <div><dt>Eingabequellen</dt><dd>{launch.sources.length ? launch.sources.map((source) => sourceLabel[source] ?? source).join(' · ') : 'Kein Starttext'}. {launch.sources.length ? launch.promptDelivery === 'argv' || launch.promptDelivery === 'pty-written' ? 'An den lokalen Prozess übergeben; dessen Verarbeitung ungeprüft.' : 'Beim Start vorbereitet; Übergabe ungeprüft.' : ''} Weitere CLI-Dateizugriffe wurden nicht erfasst.</dd></div>
        <div><dt>Git vor Start</dt><dd>{launch.git.head ? <><code title={launch.git.head}>{launch.git.head.slice(0, 12)}</code> · {launch.git.dirty === null ? 'Arbeitsbaumstatus unbekannt' : launch.git.dirty ? 'Änderungen vorhanden' : 'sauber'}</> : 'Kein verifizierter Git-HEAD'} · {launch.git.scope === 'card-worktree' ? 'Karten-Worktree' : 'Projektordner'}</dd></div>
      </dl><p className="session-evidence-provenance">Herkunft: lokaler Agentenprofil-/Startaufruf vom {new Date(launch.recordedAt).toLocaleString('de-DE')}; Git-Abfrage (`rev-parse`/`status`) vom {new Date(launch.git.checkedAt).toLocaleString('de-DE')}; CLI-Version {launch.versionCheckedAt ? `lokal mit --version geprüft am ${new Date(launch.versionCheckedAt).toLocaleString('de-DE')}` : 'nicht lokal geprüft'}. Änderungen am Profil oder Repository nach dem Start ändern diesen Beleg nicht.</p></> : <p>Für diesen älteren Lauf wurde kein Startbeleg gespeichert.</p>}
      <div className="session-evidence-qa">
        <div className="session-evidence-qa-head"><strong>Zugeordnete Browser-QA</strong><button type="button" className="text-button" disabled={busy} onClick={() => { setBusy(true); setError(''); void refresh().catch((reason) => setError(errorText(reason))).finally(() => setBusy(false)); }}>Berichte neu laden</button></div>
        {evidence?.linkedQa.length ? <ul>{evidence.linkedQa.map((item) => <li key={item.reportId}><span><strong>{item.status === 'passed' ? 'Ohne erfasste Fehler' : item.status === 'failed' ? 'Mit Fehlern' : 'Nicht abgeschlossen'}</strong> · {new Date(item.endedAt).toLocaleString('de-DE')} · {item.viewportWidth} × {item.viewportHeight}<small>{item.requestedUrl}</small></span><span className="session-evidence-actions"><button type="button" className="text-button" onClick={() => onOpenQa(item.reportId)}>Bericht öffnen</button><button type="button" className="text-button" disabled={busy || archived} onClick={() => void apply(() => window.studio.unlinkSessionQa({ projectId: session.projectId, sessionId: session.id, reportId: item.reportId }))}>Lösen</button></span></li>)}</ul> : <p>Noch keine Prüfung diesem Lauf zugeordnet.</p>}
        {archived ? <p>Archivierte Karte: Belege bleiben lesbar; Änderungen sind gesperrt.</p> : null}
        {available.length ? <form onSubmit={(event) => { event.preventDefault(); if (selected) void apply(() => window.studio.linkSessionQa({ projectId: session.projectId, sessionId: session.id, reportId: selected })); }}><label>Gespeicherter Bericht<select value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}><option value="">Bericht wählen</option>{available.map((item) => <option value={item.id} key={item.id}>{new Date(item.endedAt).toLocaleString('de-DE')} · {item.status} · {item.requestedUrl}</option>)}</select></label><button type="submit" className="secondary-button small" disabled={busy || !selected}>Zuordnen</button></form> : null}
        <small>Nur gespeicherte QA-Berichte dieser Karte ab Laufbeginn. Die Zuordnung ist manuell; sie belegt keinen vom Agenten ausgeführten Test und bindet die geladene Webseite nicht an einen Commit.</small>
      </div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>
  </details>;
}
