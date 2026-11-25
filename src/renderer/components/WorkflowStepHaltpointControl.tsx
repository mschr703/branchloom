import { useEffect, useState } from 'react';
import type { Column, Workflow } from '../../shared/types';
import type { Mutate } from './shared';

interface Props { workflow: Workflow; columns: Column[]; mutate: Mutate }

export function WorkflowStepHaltpointControl({ workflow, columns, mutate }: Props) {
  const [selected, setSelected] = useState(String(workflow.haltpoint?.afterStepIndex ?? workflow.currentStep));
  useEffect(() => { setSelected(String(workflow.haltpoint?.afterStepIndex ?? workflow.currentStep)); }, [workflow.id, workflow.haltpoint?.id, workflow.currentStep]);
  if (workflow.state === 'done' || workflow.queueSkip || workflow.steps.length < 2) return null;
  const active = workflow.haltpoint;
  const label = (index: number) => columns.find((column) => column.id === workflow.steps[index]?.columnId)?.name ?? `Schritt ${index + 1}`;
  const available = workflow.steps.slice(workflow.currentStep, -1).map((_, offset) => workflow.currentStep + offset);
  return <div className="workflow-haltpoint" aria-label="Haltepunkt zwischen Workflow-Schritten">
    {active ? <p role="status"><strong>{active.state === 'reached' ? 'Haltepunkt erreicht' : 'Haltepunkt angefordert'}</strong> · Nach Schritt {active.afterStepIndex + 1} ({label(active.afterStepIndex)}){active.state === 'reached' ? '. Der nächste Schritt wurde nicht gestartet.' : '. Laufende Karten dürfen diesen Schritt noch abschließen.'}</p>
      : <p>Nach einem Schritt anhalten</p>}
    {active?.state !== 'reached' ? <label>Grenze
      <select aria-label="Haltepunkt nach Schritt" value={selected} onChange={(event) => setSelected(event.target.value)}>{available.map((index) => <option key={workflow.steps[index]!.id} value={index}>Nach {index + 1}: {label(index)}</option>)}</select>
    </label> : null}
    <div className="workflow-haltpoint-actions">
      {active?.state !== 'reached' && available.length > 0 ? <button className="secondary-button small" type="button" disabled={active?.afterStepIndex === Number(selected)} onClick={() => void mutate(() => window.studio.setWorkflowStepHaltpoint({ id: workflow.id, afterStepIndex: Number(selected) }))}>{active ? 'Haltepunkt ändern' : 'Haltepunkt setzen'}</button> : null}
      {active ? <button className="text-button" type="button" onClick={() => void mutate(() => window.studio.setWorkflowStepHaltpoint({ id: workflow.id, afterStepIndex: null }))}>Haltepunkt aufheben</button> : null}
    </div>
  </div>;
}
