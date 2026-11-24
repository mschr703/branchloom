import type { AgentPreset, ColumnEffort, WorkflowStep } from './types';
import { COLUMN_EFFORTS } from './column-settings';

/** Step overrides are optional. Null means the column, profile or CLI default. */
export function workflowStepSettings(
  kind: AgentPreset['kind'] | null,
  rawModel: unknown,
  rawEffort: unknown,
): { model: string | null; effort: ColumnEffort | null } {
  if (rawModel != null && typeof rawModel !== 'string') throw new Error('Schritt-Modell muss Text sein.');
  const model = typeof rawModel === 'string' ? rawModel.trim() || null : null;
  if (model && (model.length > 200 || !/^[^\s\x00-\x1f\x7f-][^\s\x00-\x1f\x7f]*$/.test(model))) {
    throw new Error('Schritt-Modell muss 1–200 Zeichen ohne Leer-/Steuerzeichen haben und darf nicht mit - beginnen.');
  }
  if (rawEffort != null && !COLUMN_EFFORTS.some((item) => item.value === rawEffort)) throw new Error('Ungültiger Schritt-Effort.');
  const effort = rawEffort == null ? null : rawEffort as ColumnEffort;
  if (!kind && (model || effort)) throw new Error('Für Modell oder Effort zuerst einen Schritt-Agenten wählen.');
  if (kind === 'custom' && model) throw new Error('Ein eigener CLI-Agent benötigt Modellargumente im Agentenprofil.');
  if (kind !== 'codex' && kind !== 'antigravity' && effort) throw new Error('Schritt-Effort wird derzeit nur für Codex und Antigravity CLI unterstützt.');
  if (kind === 'antigravity' && effort === 'ultra') throw new Error('Antigravity CLI unterstützt maximal Effort „max“.');
  return { model, effort };
}

export function normalizedWorkflowStep(step: WorkflowStep): WorkflowStep {
  return { ...step, model: step.model ?? null, effort: step.effort ?? null, useWorktree: step.useWorktree === true, parallel: step.parallel === true };
}
