import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Trash2, X } from 'lucide-react';
import type { Column, ProjectSnapshot, Session } from '../../shared/types';
import type { Mutate } from './shared';
import './column-settings-sheet.css';

interface Props {
  column: Column;
  columns: Column[];
  snapshot: ProjectSnapshot;
  mutate: Mutate;
  onClose: () => void;
  onSelectCard: (cardId: string) => void;
  onReorderColumn: (column: Column, direction: 'left' | 'right') => Promise<void>;
  renameLocked: boolean;
  deleteReason: string;
  children: ReactNode;
}

const sessionState: Record<Session['state'], string> = {
  running: 'Läuft', exited: 'Beendet', failed: 'Fehlgeschlagen', stopped: 'Gestoppt',
};

export function ColumnSettingsSheet({ column, columns, snapshot, mutate, onClose, onSelectCard, onReorderColumn, renameLocked, deleteReason, children }: Props) {
  const [name, setName] = useState(column.name);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const position = columns.findIndex((item) => item.id === column.id);
  const nameChanged = name.trim() !== column.name && Boolean(name.trim());
  const agent = snapshot.agents.find((item) => item.id === column.agentId);
  const sessions = useMemo(() => {
    const cardIds = new Set(snapshot.cards.filter((card) => card.columnId === column.id).map((card) => card.id));
    return snapshot.sessions.filter((session) => cardIds.has(session.cardId)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [snapshot.cards, snapshot.sessions, column.id]);

  useEffect(() => { dialog.current?.focus(); }, []);
  useEffect(() => { setName(column.name); }, [column.name]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab' || !dialog.current) return;
    const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (document.activeElement === dialog.current) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  async function saveName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || renameLocked || !nameChanged) return;
    setBusy(true);
    try { await mutate(() => window.studio.updateColumn({ id: column.id, name: name.trim() })); }
    finally { setBusy(false); }
  }

  async function deleteColumn() {
    if (busy || deleteReason) return;
    setBusy(true);
    try {
      const result = await mutate(() => window.studio.deleteColumn(column.id));
      if (result !== null) onClose();
    } finally { setBusy(false); }
  }

  return <div className="column-settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialog} className="column-settings-sheet" role="dialog" aria-modal="true" aria-labelledby="column-settings-title" tabIndex={-1} onKeyDown={handleKeyDown}>
      <header className="column-settings-sheet-head"><div><small>Spalteneinstellungen</small><h2 id="column-settings-title">{column.name}</h2></div><button type="button" className="icon-button" aria-label="Spalteneinstellungen schließen" onClick={onClose} disabled={busy}><X size={19} /></button></header>
      <div className="column-settings-sheet-content">
        <section className="column-settings-section" aria-labelledby="column-general-title"><h3 id="column-general-title">Allgemein</h3>
          <form className="column-settings-name" onSubmit={(event) => void saveName(event)}><label>Name<input value={name} maxLength={80} required disabled={busy || renameLocked} aria-label={`Neuer Name für Spalte ${column.name}`} onChange={(event) => setName(event.target.value)} /></label><button className="secondary-button small" type="submit" disabled={busy || renameLocked || !nameChanged}>Namen speichern</button></form>
          {renameLocked ? <p className="column-settings-help">To Do kann erst nach Ausschalten der Warteschlange umbenannt werden.</p> : null}
          <div className="column-settings-order"><span>Reihenfolge</span><div><button className="secondary-button small" type="button" disabled={busy || position <= 0} aria-label={`Spalte ${column.name} nach links verschieben`} title={position <= 0 ? 'Erste Spalte' : `Vor ${columns[position - 1]?.name}`} onClick={() => void onReorderColumn(column, 'left')}><ArrowLeft size={15} /> Links</button><button className="secondary-button small" type="button" disabled={busy || position >= columns.length - 1} aria-label={`Spalte ${column.name} nach rechts verschieben`} title={position >= columns.length - 1 ? 'Letzte Spalte' : `Hinter ${columns[position + 1]?.name}`} onClick={() => void onReorderColumn(column, 'right')}>Rechts <ArrowRight size={15} /></button></div></div>
        </section>
        <section className="column-settings-section" aria-labelledby="column-agent-title"><h3 id="column-agent-title">Agent</h3><p>{agent ? `${agent.name} · ${column.autoStart ? 'Automatisch' : 'Manuell'}` : 'Noch kein Agent zugewiesen.'}</p>{children}</section>
        <section className="column-settings-section" aria-labelledby="column-automation-title"><h3 id="column-automation-title">Automatik</h3><label className="column-settings-switch"><input type="checkbox" checked={column.autoStart} disabled={!column.agentId || busy} onChange={(event) => void mutate(() => window.studio.updateColumn({ id: column.id, autoStart: event.target.checked }))} /> Agent beim Verschieben in diese Spalte automatisch starten</label><p>Der Start folgt den Projektfreigaben und den vorhandenen Schutzregeln.</p></section>
        <section className="column-settings-section" aria-labelledby="column-sessions-title"><h3 id="column-sessions-title">Sitzungen aktueller Karten <span>{sessions.length}</span></h3>{sessions.length ? <ul className="column-settings-sessions">{sessions.slice(0, 5).map((session) => { const card = snapshot.cards.find((item) => item.id === session.cardId); return <li key={session.id}><button type="button" onClick={() => onSelectCard(session.cardId)}>{card?.title ?? 'Karte'}<small>{sessionState[session.state]} · {new Date(session.startedAt).toLocaleDateString('de-DE')}</small></button></li>; })}</ul> : <p>Für Karten in dieser Spalte ist noch keine Sitzung gespeichert.</p>}{sessions.length > 5 ? <p>Die letzten fünf Sitzungen werden gezeigt. Weitere stehen in den Karten.</p> : null}</section>
        <section className="column-settings-section column-settings-danger" aria-labelledby="column-delete-title"><h3 id="column-delete-title">Spalte entfernen</h3><p>{deleteReason || 'Nur eine leere Spalte ohne Workflow-Bezug kann entfernt werden.'}</p>{confirmDelete ? <div className="column-settings-confirm"><strong>„{column.name}“ wirklich löschen?</strong><button className="danger-button small" type="button" disabled={busy || Boolean(deleteReason)} onClick={() => void deleteColumn()}>Spalte löschen</button><button className="secondary-button small" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>Abbrechen</button></div> : <button className="secondary-button small" type="button" disabled={busy || Boolean(deleteReason)} aria-label={`Spalte ${column.name} löschen`} title={deleteReason || 'Leere Spalte löschen'} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Spalte löschen</button>}</section>
      </div>
    </section>
  </div>;
}
