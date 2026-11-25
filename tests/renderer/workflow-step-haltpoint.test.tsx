import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkflowStepHaltpointControl } from '../../src/renderer/components/WorkflowStepHaltpointControl';
import { workflowPauseCopy } from '../../src/renderer/components/WorkflowView';
import type { Column, Workflow } from '../../src/shared/types';

const columns = [{ id: 'build', name: 'Build' }, { id: 'review', name: 'Review' }] as Column[];
const base: Workflow = {
  id: 'flow', projectId: 'project', name: 'Synthetic route', cardIds: ['card'],
  steps: [{ id: 'one', columnId: 'build', agentId: 'agent', requireApproval: false }, { id: 'two', columnId: 'review', agentId: 'agent', requireApproval: true }],
  state: 'running', currentStep: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('step haltpoint display', () => {
  it('distinguishes requested from reached and keeps the next approval separate', () => {
    const requested = renderToStaticMarkup(createElement(WorkflowStepHaltpointControl, { workflow: { ...base, haltpoint: { id: 'halt', afterStepIndex: 0, stepId: 'one', state: 'requested', requestedAt: '2026-01-01', reachedAt: null } }, columns, mutate: async () => true }));
    expect(requested).toContain('Haltepunkt angefordert');
    expect(requested).toContain('Laufende Karten dürfen');
    expect(requested).toContain('Haltepunkt aufheben');
    const reached = renderToStaticMarkup(createElement(WorkflowStepHaltpointControl, { workflow: { ...base, state: 'paused', currentStep: 1, haltpoint: { id: 'halt', afterStepIndex: 0, stepId: 'one', state: 'reached', requestedAt: '2026-01-01', reachedAt: '2026-01-02' } }, columns, mutate: async () => true }));
    expect(reached).toContain('Haltepunkt erreicht');
    expect(reached).toContain('Der nächste Schritt wurde nicht gestartet');
    expect(reached).not.toContain('Haltepunkt ändern');
    expect(workflowPauseCopy('haltpoint').action).toBe('Nach Haltepunkt fortsetzen');
  });
});
