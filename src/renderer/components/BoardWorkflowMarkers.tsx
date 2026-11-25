import type { BoardWorkflowSignal } from '../board-workflow-signals';

const MAX_VISIBLE_STEPS = 8;

export function BoardWorkflowMarkers({ cardId, signal }: { cardId: string; signal: BoardWorkflowSignal }) {
  const complete = signal.states.filter((state) => state === 'complete').length;
  return <span className="board-workflow-signal" title={signal.summary}>
    <span className="board-workflow-name" aria-hidden="true">{signal.workflowName}</span>
    <span className="board-workflow-steps" aria-hidden="true">{signal.states.slice(0, MAX_VISIBLE_STEPS).map((state, index) => <span key={index} className={`board-workflow-step ${state}`} />)}{signal.states.length > MAX_VISIBLE_STEPS ? <span className="board-workflow-overflow">+{signal.states.length - MAX_VISIBLE_STEPS}</span> : null}</span>
    <span className="board-workflow-count" aria-hidden="true">{complete}/{signal.states.length}</span>
    <span className="sr-only" id={`board-card-workflow-${cardId}`}>{signal.summary}</span>
  </span>;
}
