import { useRef, useState } from 'react';

/** A move into an auto-start column may launch its configured agent on the host. */
export function TeamCardColumnControl({ workspaceId, projectId, card, columns, onReload, onSaved }: {
  workspaceId: string; projectId: string;
  card: { id: string; columnId: string; revision: number };
  columns: Array<{ id: string; name: string; startsAgent?: boolean }>;
  onReload: () => Promise<void>;
  onSaved?: (agentState: 'pending' | 'dispatching' | 'started' | 'failed' | null) => void;
}) {
  const [columnId, setColumnId] = useState(card.columnId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pendingMove = useRef<{ columnId: string; mutationId: string } | null>(null);

  const apply = async () => {
    if (busy || columnId === card.columnId) return;
    setBusy(true); setError('');
    const mutationId = pendingMove.current?.columnId === columnId ? pendingMove.current.mutationId : crypto.randomUUID();
    pendingMove.current = { columnId, mutationId };
    try {
      const moved = await window.studio.moveTeamCard({ workspaceId, projectId, cardId: card.id,
        columnId, expectedRevision: card.revision, mutationId });
      pendingMove.current = null;
      onSaved?.(moved.agentLaunch?.state ?? null);
      await onReload();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message.includes('changed') ? 'Die Karte wurde inzwischen geändert. Lade den aktuellen Stand vor dem Verschieben.'
        : message.includes('Pause the project queue') ? 'Die Projekt-Warteschlange oder ein Kartenlauf ist aktiv. Pausiere ihn vor dem Verschieben.'
          : message.includes('Coordinator is unavailable') ? 'Verbindung unterbrochen. Die Aktion kann bereits erfolgt sein; erneutes Verschieben prüft dieselbe Änderungs-ID.' : message);
    } finally { setBusy(false); }
  };

  return <div className="team-card-priority">
    <label>Spalte <select aria-label="Teamkarten-Spalte" value={columnId} disabled={busy}
      onChange={(event) => { setColumnId(event.currentTarget.value); pendingMove.current = null; setError(''); }}>
      {columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
    </select></label>
    {columns.find((column) => column.id === columnId)?.startsAgent && columnId !== card.columnId ?
      <p className="team-card-start-warning">Diese Spalte startet ihren Agenten auf dem Host in einem eigenen Git-Worktree. Dafür brauchst du Aufgabensteuerung und Agentenstartrecht.</p> : null}
    <button type="button" className="secondary-button" disabled={busy || columnId === card.columnId}
      onClick={() => void apply()}>Verschieben</button>
    {error ? <p className="inline-error" role="alert">{error} <button type="button" className="text-button"
      onClick={() => void onReload()}>Aktuellen Stand laden</button></p> : null}
  </div>;
}
