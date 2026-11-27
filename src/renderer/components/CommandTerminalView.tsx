import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { CircleStop, Play, TerminalSquare } from 'lucide-react';
import type { Card, Column, CommandShell, CommandTerminal, CommandTerminalTarget } from '../../shared/types';
import { OutputErrorPanel } from './OutputErrorPanel';
import '../command-terminal.css';

const TerminalDisplay = lazy(async () => ({ default: (await import('./SessionTerminal')).SessionTerminal }));

const shellName = (shell: CommandShell) => shell === 'powershell' ? 'PowerShell' : 'Eingabeaufforderung';

export function CommandTerminalView({ projectId, projectPath, columns, onOpenCard }: { projectId: string; projectPath?: string; columns: Column[]; onOpenCard: (card: Card) => void | Promise<void> }) {
  const [rows, setRows] = useState<CommandTerminal[]>([]);
  const [targets, setTargets] = useState<CommandTerminalTarget[]>([]);
  const [targetCardId, setTargetCardId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shell, setShell] = useState<CommandShell>('powershell');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // A delayed IPC response from the previous project must never populate the
  // newly selected project's terminal, even if its process started there.
  const generation = useRef(0);
  const selected = rows.find((item) => item.id === selectedId) ?? null;
  const active = rows.find((item) => item.state === 'running') ?? null;
  const selectedTarget = targets.find((item) => item.cardId === targetCardId);

  useEffect(() => {
    const current = ++generation.current;
    let live = true;
    setRows([]);
    setTargets([]);
    setTargetCardId('');
    setSelectedId(null);
    setError('');
    void window.studio.commandTerminals(projectId).then((items) => {
      if (!live) return;
      setRows(items);
      setSelectedId(items.find((item) => item.state === 'running')?.id ?? items[0]?.id ?? null);
    }).catch((reason: unknown) => { if (live) setError(String(reason)); });
    void window.studio.commandTerminalTargets(projectId).then((items) => { if (live) setTargets(items); }).catch((reason: unknown) => { if (live) setError(String(reason)); });
    const unsubscribe = window.studio.onCommandTerminalEvent((event) => {
      if (!live || event.projectId !== projectId) return;
      setRows((old) => old.map((item) => item.id === event.terminalId
        ? event.type === 'output' ? { ...item, output: (item.output + event.data).slice(-100_000) }
          : { ...item, state: event.state ?? item.state, endedAt: event.state === 'running' ? null : new Date().toISOString() }
        : item));
      if (event.type === 'state') void window.studio.commandTerminals(projectId).then((items) => { if (live) setRows(items); }).catch(() => undefined);
    });
    return () => { live = false; if (generation.current === current) generation.current += 1; unsubscribe(); };
  }, [projectId]);

  async function start() {
    if (busy || active) return;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const created = await window.studio.startCommandTerminal({ projectId, shell, cardId: targetCardId || null });
      const items = await window.studio.commandTerminals(projectId);
      if (generation.current === current) { setRows(items); setSelectedId(created.id); }
    } catch (reason) { if (generation.current === current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (generation.current === current) setBusy(false); }
  }

  async function stop() {
    if (!selected || selected.state !== 'running' || busy) return;
    const current = generation.current;
    setBusy(true); setError('');
    try {
      await window.studio.stopCommandTerminal(selected.id);
      const items = await window.studio.commandTerminals(projectId);
      if (generation.current === current) setRows(items);
    } catch (reason) { if (generation.current === current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (generation.current === current) setBusy(false); }
  }

  return <div className="standard-page command-terminal-page">
    <div className="view-header"><div><h2>Manuelles Projekt-Terminal</h2><p>Für eigene Git-Befehle, Tests oder kurze Prüfungen. Agentenläufe und ihre Ausgaben findest du auf der jeweiligen Karte; dieses Terminal bedienst nur du.</p></div></div>
    <div className="command-terminal-start panel">
      <label>Shell<select aria-label="Shell auswählen" value={shell} disabled={busy || Boolean(active)} onChange={(event) => setShell(event.target.value as CommandShell)}><option value="powershell">Windows PowerShell</option><option value="cmd">Eingabeaufforderung (cmd)</option></select></label>
      <label>Arbeitsordner<select aria-label="Terminal-Arbeitsordner auswählen" value={targetCardId} disabled={busy || Boolean(active)} onChange={(event) => setTargetCardId(event.target.value)}><option value="">Projektordner</option>{targets.map((target) => <option key={target.cardId} value={target.cardId}>{target.cardTitle} · {target.branch}</option>)}</select></label>
      <button className="primary-button" type="button" disabled={busy || Boolean(active)} onClick={() => void start()}><Play size={15} /> Terminal starten</button>
      <p className="command-terminal-cwd"><strong>Arbeitsordner</strong><code>{selectedTarget?.path ?? projectPath ?? 'Projektordner'}</code></p>
      <p>Höchstens ein laufendes Befehlsterminal pro Projekt. Der Karten-Worktree wird beim Start erneut geprüft. Nach einem App-Neustart wird ein unterbrochener Lauf als fehlgeschlagen markiert; er startet nicht von selbst erneut.</p>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    <div className="command-terminal-layout">
      <section className="panel command-terminal-history" aria-label="Terminalverlauf"><h3>Letzte Terminals</h3>{rows.length ? rows.map((item) => <button className={item.id === selectedId ? 'command-terminal-history-item selected' : 'command-terminal-history-item'} key={item.id} type="button" onClick={() => setSelectedId(item.id)} aria-current={item.id === selectedId ? 'true' : undefined}><TerminalSquare size={16} /><span><strong>{shellName(item.shell)}</strong><small>{item.cardId ? `Karte · ${targets.find((target) => target.cardId === item.cardId)?.cardTitle ?? item.cardId}` : 'Projektordner'} · {new Date(item.startedAt).toLocaleString('de-DE')} · {item.state}</small></span></button>) : <p>Noch kein Terminal gestartet.</p>}</section>
      <section className="panel command-terminal-screen" aria-label="Befehlsterminal">
        {selected ? <><div className="command-terminal-screen-header"><div><strong>{shellName(selected.shell)}</strong><span>{selected.cardId ? `Karten-Worktree: ${selected.worktreePath ?? 'Pfad unbekannt'}` : `Projektordner: ${projectPath ?? 'Pfad nicht angezeigt'}`} · {selected.state === 'running' ? 'Läuft' : `Beendet: ${selected.state}${selected.exitCode !== null ? ` (${selected.exitCode})` : ''}`}</span></div>{selected.state === 'running' ? <button className="secondary-button small" type="button" disabled={busy} onClick={() => void stop()}><CircleStop size={15} /> Stoppen</button> : null}</div><Suspense fallback={<p>Terminal wird geladen…</p>}><TerminalDisplay session={selected} ariaLabel="Interaktives Befehlsterminal" onInput={(id, data) => window.studio.writeCommandTerminal({ terminalId: id, data })} onResize={(id, cols, rows) => window.studio.resizeCommandTerminal({ terminalId: id, cols, rows })} /></Suspense>{selected.state !== 'running' ? <OutputErrorPanel key={selected.id} projectId={projectId} sourceKind="command" sourceId={selected.id} columns={columns} onCreated={onOpenCard} /> : null}</> : <div className="feature-empty"><TerminalSquare size={28} /><h3>Noch kein Terminal</h3><p>Wähle oben den Arbeitsordner und die Shell. Befehle laufen erst, wenn du sie eingibst.</p></div>}
      </section>
    </div>
  </div>;
}
