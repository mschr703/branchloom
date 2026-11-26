import { useState } from 'react';

/** A board move is explicit and does not start the destination column's agent. */
export function TeamCardColumnControl({ workspaceId, projectId, card, columns, onReload, onSaved }: {
  workspaceId: string; projectId: string;
  card: { id: string; columnId: string; revision: number };
  columns: Array<{ id: string; name: string }>;
  onReload: () => Promise<void>;
  onSaved?: () => void;
}) {
  const [columnId, setColumnId] = useState(card.columnId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = async () => {
    if (busy || columnId === card.columnId) return;
    setBusy(true); setError('');
    try {
      await window.studio.moveTeamCard({ workspaceId, projectId, cardId: card.id,
        columnId, expectedRevision: card.revision, mutationId: crypto.randomUUID() });
      await onReload();
      onSaved?.();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message.includes('changed') ? 'Die Karte wurde inzwischen geändert. Lade den aktuellen Stand vor dem Verschieben.'
        : message.includes('Pause the project queue') ? 'Die Projekt-Warteschlange oder ein Kartenlauf ist aktiv. Pausiere ihn vor dem Verschieben.' : message);
    } finally { setBusy(false); }
  };

  return <div className="team-card-priority">
    <label>Spalte <select aria-label="Teamkarten-Spalte" value={columnId} disabled={busy}
      onChange={(event) => setColumnId(event.currentTarget.value)}>
      {columns.map((column) => <option key={column.id} value={column.id}>{column.name}</option>)}
    </select></label>
    <button type="button" className="secondary-button" disabled={busy || columnId === card.columnId}
      onClick={() => void apply()}>Verschieben</button>
    {error ? <p className="inline-error" role="alert">{error} <button type="button" className="text-button"
      onClick={() => void onReload()}>Aktuellen Stand laden</button></p> : null}
  </div>;
}
