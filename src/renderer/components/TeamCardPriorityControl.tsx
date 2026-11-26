import { useState } from 'react';
import type { CardPriority } from '../../shared/types';

const choices: Array<{ value: CardPriority; label: string }> = [
  { value: 'none', label: 'Keine' }, { value: 'low', label: 'Niedrig' },
  { value: 'medium', label: 'Mittel' }, { value: 'high', label: 'Hoch' },
  { value: 'urgent', label: 'Dringend' },
];

/** Authoritative metadata stays separate from the shared text document. */
export function TeamCardPriorityControl({ workspaceId, projectId, card, onReload, onSaved }: {
  workspaceId: string; projectId: string;
  card: { id: string; priority: CardPriority; revision: number };
  onReload: () => Promise<void>;
  onSaved?: () => void;
}) {
  const [priority, setPriority] = useState<CardPriority>(card.priority);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const apply = async () => {
    if (busy || priority === card.priority) return;
    setBusy(true); setError('');
    try {
      await window.studio.setTeamCardPriority({ workspaceId, projectId, cardId: card.id,
        priority, expectedRevision: card.revision, mutationId: crypto.randomUUID() });
      await onReload();
      onSaved?.();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message.includes('changed') ? 'Die Karte wurde inzwischen geändert. Lade den aktuellen Stand, bevor du erneut entscheidest.' : message);
    } finally { setBusy(false); }
  };

  return <div className="team-card-priority">
    <label>Priorität <select aria-label="Teamkarten-Priorität" value={priority} disabled={busy}
      onChange={(event) => setPriority(event.currentTarget.value as CardPriority)}>
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select></label>
    <button type="button" className="secondary-button" disabled={busy || priority === card.priority}
      onClick={() => void apply()}>Übernehmen</button>
    {error ? <p className="inline-error" role="alert">{error} <button type="button" className="text-button"
      onClick={() => void onReload()}>Aktuellen Stand laden</button></p> : null}
  </div>;
}
