import { useEffect, useState } from 'react';
import { ArrowUpRight, Square, Play } from 'lucide-react';
import type { DevEnvironmentProfile, CardDevEnvironment, DevEnvironmentInspection, GuidedDevEnvironmentAdvice, DevEnvironmentAuditEvent } from '../../shared/dev-environment';
import './card-dev-environment.css';

interface Props { cardId: string; projectId: string; archived: boolean; onOpenBrowser?: () => void }

function message(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }

export function CardDevEnvironmentPanel({ cardId, projectId, archived, onOpenBrowser }: Props) {
  const [profile, setProfile] = useState<DevEnvironmentProfile | null>(null);
  const [run, setRun] = useState<CardDevEnvironment | null>(null);
  const [executable, setExecutable] = useState('');
  const [argsText, setArgsText] = useState('');
  const [healthPath, setHealthPath] = useState('/');
  const [healthMarker, setHealthMarker] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inspection, setInspection] = useState<DevEnvironmentInspection | null>(null);
  const [advice, setAdvice] = useState<GuidedDevEnvironmentAdvice | null>(null);
  const [audit, setAudit] = useState<DevEnvironmentAuditEvent[]>([]);

  useEffect(() => {
    let live = true;
    setProfile(null); setRun(null); setError(''); setEditing(false); setInspection(null); setAdvice(null);
    void Promise.all([window.studio.devEnvironmentProfile(projectId), window.studio.cardDevEnvironment(cardId), window.studio.devEnvironmentAudit({ projectId, cardId })])
      .then(([saved, latest, entries]) => {
        if (!live) return;
        setProfile(saved); setRun(latest); setAudit(entries); setEditing(!saved);
        setExecutable(saved?.executable ?? ''); setArgsText(saved?.args.join('\n') ?? '');
        setHealthPath(saved?.healthPath ?? '/'); setHealthMarker(saved?.healthMarker ?? '');
      }).catch((reason) => { if (live) setError(message(reason)); });
    return () => { live = false; };
  }, [cardId, projectId]);

  useEffect(() => {
    if (run?.state !== 'starting' && run?.state !== 'ready') return;
    let live = true;
    const timer = setInterval(() => {
      void window.studio.cardDevEnvironment(cardId)
        .then((next) => { if (live) setRun(next); })
        .catch((reason) => { if (live) setError(message(reason)); });
    }, 1200);
    return () => { live = false; clearInterval(timer); };
  }, [cardId, run?.state]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const saved = await window.studio.saveDevEnvironmentProfile({ projectId, executable, args: argsText.split(/\r?\n/u).filter((arg) => arg.length > 0), healthPath, healthMarker });
      setProfile(saved); setEditing(false); setInspection(null); setAdvice(null);
      setAudit(await window.studio.devEnvironmentAudit({ projectId, cardId }));
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function start() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!profile) throw new Error('Projektprofil zuerst laden.');
      setRun(await window.studio.startCardDevEnvironment({ cardId, expectedProfileFingerprint: profile.fingerprint }));
      setAdvice(null); setInspection(null);
    } catch (reason) {
      setError(message(reason)); setRun(await window.studio.cardDevEnvironment(cardId).catch(() => null));
      setProfile(await window.studio.devEnvironmentProfile(projectId).catch(() => profile));
    }
    finally { setAudit(await window.studio.devEnvironmentAudit({ projectId, cardId }).catch(() => audit)); setBusy(false); }
  }

  async function inspect() {
    if (busy) return;
    setBusy(true); setError(''); setAdvice(null);
    try { setInspection(await window.studio.inspectDevEnvironment({ projectId, cardId })); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function askAgent() {
    if (busy) return;
    setBusy(true); setError(''); setAdvice(null);
    try {
      const answer = await window.studio.adviseDevEnvironment({ projectId, cardId });
      setInspection(answer.inspection); setAdvice(answer);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function applyAdvice() {
    if (!advice?.candidateId || busy) return;
    setBusy(true); setError('');
    try {
      const saved = await window.studio.applyGuidedDevEnvironment({ adviceId: advice.id, projectId, cardId });
      setProfile(saved); setExecutable(saved.executable); setArgsText(saved.args.join('\n'));
      setHealthPath(saved.healthPath); setHealthMarker(saved.healthMarker);
      setEditing(false); setAdvice(null); setInspection(null);
      setAudit(await window.studio.devEnvironmentAudit({ projectId, cardId }));
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function stop() {
    if (!run || busy) return;
    setBusy(true); setError('');
    try { setRun(await window.studio.stopCardDevEnvironment(run.id)); }
    catch (reason) { setError(message(reason)); setRun(await window.studio.cardDevEnvironment(cardId).catch(() => run)); }
    finally { setBusy(false); }
  }

  async function refreshRun() {
    if (busy) return;
    setBusy(true); setError('');
    try { setRun(await window.studio.cardDevEnvironment(cardId)); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function openPreview() {
    if (!run || run.state !== 'ready' || !run.managed || busy) return;
    setBusy(true); setError('');
    try {
      await window.studio.browserNewTab();
      await window.studio.browserNavigate(run.url);
      onOpenBrowser?.();
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  return <section className="card-dev-env" aria-label="Karten-Vorschau">
    <div className="card-dev-env-heading"><div><h3>Karten-Vorschau</h3><p>Startet die Version aus dem Git-Worktree dieser Karte auf einem eigenen lokalen Port.</p></div>
      {profile ? <button className="text-button" type="button" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>{editing ? 'Profil schließen' : 'Projektprofil bearbeiten'}</button> : null}</div>
    <div className="card-dev-env-guide-actions"><button className="text-button" type="button" disabled={busy || archived} onClick={() => void inspect()}>Projektstand prüfen</button><button className="text-button" type="button" disabled={busy || archived} onClick={() => void askAgent()}>{busy ? 'Prüfung läuft…' : run?.state === 'failed' ? 'Fehler mit Agent besprechen' : 'Einrichtung mit Agent besprechen'}</button></div>
    {inspection ? <div className="card-dev-env-guide" aria-label="Geprüfte Einrichtung">
      <p>{inspection.warning ?? `${inspection.candidates.length} belegter Startvorschlag aus Git HEAD.`}</p>
      {inspection.profileMismatch.length ? <p>Abweichung zum gespeicherten Profil: {inspection.profileMismatch.map((item) => item === 'executable' ? 'Programm' : item === 'arguments' ? 'Argumente' : item === 'health-path' ? 'Prüfpfad' : 'Marker').join(', ')}.</p> : null}
      {inspection.failureKind !== 'none' ? <p>Letzter Fehler: {inspection.failureKind === 'missing-dependency' ? 'Abhängigkeit im Karten-Worktree fehlt' : inspection.failureKind === 'port-in-use' ? 'Port belegt' : inspection.failureKind === 'readiness' ? 'Bereitschaftsprüfung fehlgeschlagen' : 'Start fehlgeschlagen'}. Die Prozessausgabe bleibt lokal.</p> : null}
      {inspection.evidence.length ? <details><summary>Quellen ansehen</summary><ul>{inspection.evidence.map((item) => <li key={item.id}>{item.detail}</li>)}</ul></details> : null}
      {!advice && inspection.candidates.length === 1 ? <button type="button" className="text-button" disabled={busy} onClick={() => {
        const candidate = inspection.candidates[0]!.profile;
        setExecutable(candidate.executable); setArgsText(candidate.args.join('\n')); setHealthPath(candidate.healthPath); setHealthMarker(candidate.healthMarker); setEditing(true);
      }}>Kandidat ins Formular übernehmen</button> : null}
      {advice ? <><p><strong>Agent:</strong> {advice.diagnosis}</p><p>{advice.nextStep}</p>
        {advice.candidateId ? (() => { const candidate = advice.inspection.candidates.find((item) => item.id === advice.candidateId); return candidate ? <div className="card-dev-env-proposal"><p><strong>Vorgeschlagenes Profil</strong> · {candidate.label}</p><code>{candidate.profile.executable} {candidate.profile.args.join(' ')}</code><small>Prüfpfad {candidate.profile.healthPath} · Marker {candidate.profile.healthMarker}</small><button type="button" className="secondary-button" disabled={busy} onClick={() => void applyAdvice()}>Profil übernehmen</button><small>Speichert nur das Profil. Der Server startet erst nach einem eigenen Klick.</small></div> : null; })() : <p>Kein belegter Profilvorschlag. Das bestehende Profil bleibt erhalten.</p>}
      </> : null}
    </div> : null}
    {editing ? <form className="card-dev-env-form" onSubmit={(event) => void save(event)}>
      <p>Ein Projektprofil gilt für alle Karten. Es führt erst nach deinem Startklick ein direktes Programm im Karten-Worktree aus.</p>
      <label>Programm<input value={executable} maxLength={260} onChange={(event) => setExecutable(event.target.value)} placeholder="node" /></label>
      <label>Argumente · eine Zeile je Argument<textarea value={argsText} rows={5} onChange={(event) => setArgsText(event.target.value)} placeholder={'dev-server.js\n--host\n127.0.0.1\n--port\n{port}'} /></label>
      <div className="card-dev-env-fields"><label>Prüfpfad<input value={healthPath} maxLength={200} onChange={(event) => setHealthPath(event.target.value)} placeholder="/" /></label><label>Text auf der bereiten Seite<input value={healthMarker} maxLength={120} onChange={(event) => setHealthMarker(event.target.value)} placeholder="Name deiner App" /></label></div>
      <small>Die Argumente brauchen <code>{'{port}'}</code> und <code>127.0.0.1</code>. Der Text muss im HTTP-Ergebnis des Prüfpfads stehen. Keine Schlüssel in Befehle schreiben.</small>
      <button className="secondary-button" type="submit" disabled={busy || !executable.trim() || !healthMarker.trim()}>Projektprofil speichern</button>
    </form> : null}
    {profile ? <div className="card-dev-env-actions"><button className="secondary-button" type="button" disabled={archived || busy || run?.state === 'starting' || run?.state === 'ready'} onClick={() => void start()}><Play size={14} aria-hidden="true" /> Für diese Karte starten</button>
      {run?.managed && (run.state === 'starting' || run.state === 'ready') ? <button className="text-button" type="button" disabled={busy} onClick={() => void stop()}><Square size={13} aria-hidden="true" /> Stoppen</button> : null}
      {run?.managed && run.state === 'ready' ? <button className="text-button" type="button" disabled={busy} onClick={() => void openPreview()}>Vorschau öffnen <ArrowUpRight size={14} aria-hidden="true" /></button> : null}</div> : null}
    {run ? <div className="card-dev-env-state" role="status"><strong>{!run.managed && (run.state === 'starting' || run.state === 'ready') ? 'Frühere Sitzung möglicherweise aktiv' : run.state === 'starting' ? 'Startet und prüft…' : run.state === 'ready' ? 'Bereit' : run.state === 'interrupted' ? 'Nach Unterbrechung prüfen' : run.state === 'failed' ? 'Start fehlgeschlagen' : 'Gestoppt'}</strong><span>{run.url}</span><small>Branch {run.branch} · Worktree {run.worktreePath} · Start-PID {run.pid ?? 'unbekannt'}</small>
      {!run.managed && (run.state === 'starting' || run.state === 'ready' || run.state === 'interrupted') ? <p>Prüfe Port und Programm im Task-Manager und beende nur den verifizierten alten Server. Eine PID kann inzwischen zu einem anderen Prozess gehören. Danach Status erneut prüfen.</p> : null}
      {!run.managed && (run.state === 'starting' || run.state === 'ready' || run.state === 'interrupted') ? <button className="text-button" type="button" disabled={busy} onClick={() => void refreshRun()}>Status erneut prüfen</button> : null}
      {run.output ? <details><summary>Prozessausgabe</summary><pre>{run.output}</pre></details> : null}</div> : null}
    {audit.length ? <details className="card-dev-env-audit"><summary>Einrichtungsbelege</summary><ol>{audit.map((entry) => <li key={entry.id}>{new Date(entry.at).toLocaleString('de-DE')} · {entry.kind === 'profile' ? 'Profil gespeichert' : entry.outcome === 'started' ? 'Start freigegeben' : entry.outcome === 'rejected' ? 'Start abgewiesen' : 'Start angefordert'} · {entry.source === 'guided' ? 'Agentenvorschlag bestätigt' : entry.source === 'manual' ? 'manuell' : 'Kartenklick'} · {entry.profileFingerprint.slice(0, 10)}</li>)}</ol></details> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
