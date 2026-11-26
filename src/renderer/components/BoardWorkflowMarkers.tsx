import type { BoardWorkflowSignal } from '../board-workflow-signals';

const MAX_VISIBLE_STEPS = 8;

export function BoardWorkflowMarkers({ cardId, signal }: { cardId: string; signal: BoardWorkflowSignal }) {
  const complete = signal.states.filter((state) => state === 'complete').length;
  const attentionState = signal.states.includes('needs_review') ? 'needs_review'
    : signal.states.includes('manual_wait') ? 'manual_wait'
      : signal.states.includes('running') ? 'running' : null;
  const attentionIndex = attentionState ? signal.states.indexOf(attentionState) : -1;
  const attentionLabel = attentionState === 'needs_review' ? 'Review nötig'
    : attentionState === 'manual_wait' ? 'Wartet auf dich'
      : attentionState === 'running' ? 'Agent läuft' : null;
  return <span className="board-workflow-signal" data-attention={attentionState ?? undefined} title={signal.summary}>
    <span className="board-workflow-name" aria-hidden="true">{signal.workflowName}</span>
    <span className="board-workflow-steps" aria-hidden="true">{signal.states.slice(0, MAX_VISIBLE_STEPS).map((state, index) => <span key={index} className={`board-workflow-step ${state}${index === attentionIndex ? ' is-current' : ''}`} />)}{signal.states.length > MAX_VISIBLE_STEPS ? <span className="board-workflow-overflow">+{signal.states.length - MAX_VISIBLE_STEPS}</span> : null}</span>
    {attentionLabel ? <span className="board-workflow-attention" aria-hidden="true">{attentionLabel}</span> : null}
    <span className="board-workflow-count" aria-hidden="true">{complete}/{signal.states.length}</span>
    <span className="sr-only" id={`board-card-workflow-${cardId}`}>{signal.summary}</span>
  </span>;
}
