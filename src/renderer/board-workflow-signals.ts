import type { Workflow } from '../shared/types';
import type { WorkflowRunEvidence, WorkflowProgressState } from '../shared/workflow-evidence';

export type BoardStepState = WorkflowProgressState | 'not-recorded';

export interface BoardWorkflowSignal {
  workflowId: string;
  workflowName: string;
  states: BoardStepState[];
  summary: string;
}

const stateText: Record<BoardStepState, string> = {
  'not-recorded': 'noch ohne Laufbeleg',
  pending: 'vorgemerkt',
  running: 'läuft',
  complete: 'abgeschlossen',
  needs_review: 'Review nötig',
  manual_wait: 'wartet auf manuellen Schritt',
};

/** Show only persisted progress rows for a card; never derive completion from the route index. */
export function cardWorkflowSignal(cardId: string, workflows: Workflow[], evidence: Record<string, WorkflowRunEvidence>): BoardWorkflowSignal | null {
  const workflow = workflows
    .filter((item) => (item.state === 'running' || item.state === 'paused') && item.cardIds.includes(cardId)
      && evidence[item.id] && !evidence[item.id]!.moreAvailable && evidence[item.id]!.rows.some((row) => row.cardId === cardId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
  if (!workflow || !workflow.steps.length) return null;
  const recorded = evidence[workflow.id]!;
  const rows = recorded.rows.filter((item) => item.cardId === cardId);
  const states = workflow.steps.map((_, index) => rows.find((row) => row.stepIndex === index)?.state ?? 'not-recorded');
  const complete = states.filter((state) => state === 'complete').length;
  const summary = `${workflow.name}: ${complete} von ${states.length} Schritten als abgeschlossen gespeichert. ${states.map((state, index) => `Schritt ${index + 1} ${stateText[state]}`).join('; ')}`;
  return { workflowId: workflow.id, workflowName: workflow.name, states, summary };
}
