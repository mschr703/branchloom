import { useEffect, useState } from 'react';
import { ArrowUpRight, Square, Play } from 'lucide-react';
import type { DevEnvironmentProfile, CardDevEnvironment } from '../../shared/dev-environment';
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

  useEffect(() => {
    let live = true;
    setProfile(null); setRun(null); setError(''); setEditing(false);
    void Promise.all([window.studio.devEnvironmentProfile(projectId), window.studio.cardDevEnvironment(cardId)])
      .then(([saved, latest]) => {
        if (!live) return;
        setProfile(saved); setRun(latest); setEditing(!saved);
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
      setProfile(saved); setEditing(false);
    } catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  }

  async function start() {
    if (busy) return;
    setBusy(true); setError('');
    try { setRun(await window.studio.startCardDevEnvironment(cardId)); }
    catch (reason) { setError(message(reason)); setRun(await window.studio.cardDevEnvironment(cardId).catch(() => null)); }
    finally { setBusy(false); }
  }

  async function stop() {
    if (!run || busy) return;
    setBusy(true); setError('');
    try { setRun(await window.studio.stopCardDevEnvironment(run.id)); }
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
    {run ? <div className="card-dev-env-state" role="status"><strong>{run.state === 'starting' ? 'Startet und prüft…' : run.state === 'ready' ? 'Bereit' : run.state === 'interrupted' ? 'Nach Neustart ungeklärt' : run.state === 'failed' ? 'Start fehlgeschlagen' : 'Gestoppt'}</strong><span>{run.url}</span><small>Branch {run.branch} · Worktree {run.worktreePath}</small>
      {run.state === 'ready' && !run.managed ? <p>Der frühere Prozess gehört nicht zu dieser App-Sitzung. Die Vorschau wird nicht als geprüft geöffnet.</p> : null}
      {run.output ? <details><summary>Prozessausgabe</summary><pre>{run.output}</pre></details> : null}</div> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </section>;
}
