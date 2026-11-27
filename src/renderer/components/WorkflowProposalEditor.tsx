import type { Column, WorkflowProposal } from '../../shared/types';
import './workflow-proposal-editor.css';

export function WorkflowProposalEditor({ proposal, columns, disabled, changed, saving, onChange, onSave, onReset }: {
  proposal: WorkflowProposal;
  columns: Column[];
  disabled: boolean;
  changed: boolean;
  saving: boolean;
  onChange: (proposal: WorkflowProposal) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const updateCard = (index: number, change: Partial<WorkflowProposal['cards'][number]>) =>
    onChange({ ...proposal, cards: proposal.cards.map((card, position) => position === index ? { ...card, ...change } : card) });
  return <details className="workflow-proposal-editor">
    <summary>Vorschlag vor Übernahme bearbeiten{changed ? ' · ungespeichert' : ''}</summary>
    <div className="workflow-proposal-edit-fields">
      <label>Name<input value={proposal.title} maxLength={160} disabled={disabled} onChange={(event) => onChange({ ...proposal, title: event.target.value })} /></label>
      <label>Begründung<textarea rows={3} maxLength={4000} disabled={disabled} value={proposal.explanation} onChange={(event) => onChange({ ...proposal, explanation: event.target.value })} /></label>
      <div className="workflow-proposal-edit-cards"><strong>Karten</strong>{proposal.cards.map((card, index) => <div className="workflow-proposal-edit-card" key={index}>
        <label>Titel {index + 1}<input value={card.title} maxLength={200} disabled={disabled} onChange={(event) => updateCard(index, { title: event.target.value })} /></label>
        <label>Beschreibung<textarea rows={2} maxLength={10000} disabled={disabled} value={card.description} onChange={(event) => updateCard(index, { description: event.target.value })} /></label>
        {proposal.cards.length > 1 ? <button className="text-button" type="button" disabled={disabled} onClick={() => onChange({ ...proposal, cards: proposal.cards.filter((_, position) => position !== index) })}>Karte entfernen</button> : null}
      </div>)}
        {proposal.cards.length < 20 ? <button className="secondary-button small" type="button" disabled={disabled} onClick={() => onChange({ ...proposal, cards: [...proposal.cards, { title: '', description: '' }] })}>Karte ergänzen</button> : null}
      </div>
      <fieldset className="workflow-proposal-edit-route"><legend>Schrittfolge</legend><p>Markiere die Spalten. Neue Schritte werden am Ende ergänzt.</p>{columns.map((column) => <label key={column.id}><input type="checkbox" checked={proposal.columnIds.includes(column.id)} disabled={disabled} onChange={(event) => onChange({ ...proposal, columnIds: event.target.checked ? [...proposal.columnIds, column.id] : proposal.columnIds.filter((id) => id !== column.id) })} />{column.name}</label>)}
        {proposal.columnIds.length > 1 ? <div className="workflow-proposal-route-order">{proposal.columnIds.map((id, index) => <div key={id}><span>{index + 1}. {columns.find((column) => column.id === id)?.name ?? id}</span><button type="button" className="text-button" disabled={disabled || index === 0} aria-label={`${id} nach oben`} onClick={() => { const ids = [...proposal.columnIds]; [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!]; onChange({ ...proposal, columnIds: ids }); }}>↑</button></div>)}</div> : null}
      </fieldset>
      <div className="workflow-proposal-edit-actions"><span>Speichern erzeugt eine neue prüfbare Version, aber keine Board-Karten.</span><button className="secondary-button small" type="button" disabled={disabled || !changed} onClick={onReset}>Verwerfen</button><button className="primary-button small" type="button" disabled={disabled || !changed || !proposal.title.trim() || !proposal.cards.every((card) => card.title.trim()) || !proposal.columnIds.length} onClick={onSave}>{saving ? 'Speichere…' : 'Änderungen speichern'}</button></div>
    </div>
  </details>;
}
