import type { AgentPreset, Column } from '../../shared/types';
import { COLUMN_EFFORTS } from '../../shared/column-settings';
import './workflow-step-rows.css';

interface Props {
  columns: Column[];
  agents: AgentPreset[];
  selectedIds: string[];
  approvalIds: string[];
  worktreeIds: string[];
  parallelIds: string[];
  agentByColumn: Record<string, string>;
  modelByColumn: Record<string, string>;
  effortByColumn: Record<string, string>;
  toggleStep: (id: string) => void;
  toggleApproval: (id: string) => void;
  toggleWorktree: (id: string) => void;
  toggleParallel: (id: string) => void;
  changeAgent: (id: string, agentId: string) => void;
  changeModel: (id: string, model: string) => void;
  changeEffort: (id: string, effort: string) => void;
}

export function WorkflowStepRows(props: Props) {
  return <div className="step-form-list">
    {props.columns.map((column) => {
      const selected = props.selectedIds.includes(column.id);
      const agentId = props.agentByColumn[column.id] ?? column.agentId ?? '';
      const agent = props.agents.find((item) => item.id === agentId);
      const canSetModel = selected && Boolean(agent) && agent?.kind !== 'custom';
      const canSetEffort = selected && (agent?.kind === 'codex' || agent?.kind === 'antigravity');
      const inheritedModel = agentId === column.agentId ? column.model || agent?.model : agent?.model;
      return <div className="workflow-step-row" key={column.id} aria-label={`Schritt ${column.name}`}>
        <div className="workflow-step-row-head">
          <label className="step-main"><input type="checkbox" checked={selected} onChange={() => props.toggleStep(column.id)} /> <span>{column.name}</span></label>
          <label className="approval-check"><input type="checkbox" checked={props.approvalIds.includes(column.id)} disabled={!selected} onChange={() => props.toggleApproval(column.id)} /> Freigabe vor Start</label>
          <label className="approval-check"><input type="checkbox" aria-label={`Karten-Worktree für ${column.name}`} checked={props.worktreeIds.includes(column.id) && Boolean(agentId)} disabled={!selected || !agentId} onChange={() => props.toggleWorktree(column.id)} /> Karten-Worktree</label>
          <label className="approval-check"><input type="checkbox" aria-label={`Karten in ${column.name} parallel bearbeiten`} checked={props.parallelIds.includes(column.id) && props.worktreeIds.includes(column.id) && Boolean(agentId)} disabled={!selected || !agentId || !props.worktreeIds.includes(column.id)} onChange={() => props.toggleParallel(column.id)} /> Karten parallel</label>
        </div>
        <div className="workflow-step-row-settings">
          <label>Agent<select aria-label={`Agent für ${column.name}`} value={agentId} disabled={!selected} onChange={(event) => props.changeAgent(column.id, event.target.value)}><option value="">Manuell</option>{props.agents.filter((item) => item.enabled || item.id === agentId).map((item) => <option key={item.id} value={item.id} disabled={!item.enabled}>{item.name}{item.enabled ? '' : ' (deaktiviert)'}</option>)}</select></label>
          <label>Modell<input aria-label={`Modell für ${column.name}`} value={props.modelByColumn[column.id] ?? ''} disabled={!canSetModel} maxLength={200} placeholder={inheritedModel || 'Spalten-/Profilstandard'} onChange={(event) => props.changeModel(column.id, event.target.value)} /></label>
          <label>Effort<select aria-label={`Effort für ${column.name}`} value={props.effortByColumn[column.id] ?? ''} disabled={!canSetEffort} onChange={(event) => props.changeEffort(column.id, event.target.value)}><option value="">Spalten-/CLI-Standard</option>{COLUMN_EFFORTS.filter((item) => agent?.kind !== 'antigravity' || item.value !== 'ultra').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
      </div>;
    })}
  </div>;
}
