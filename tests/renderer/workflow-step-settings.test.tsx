import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { stepsFromForm } from '../../src/renderer/components/WorkflowView';
import { WorkflowStepRows } from '../../src/renderer/components/WorkflowStepRows';
import type { AgentPreset, Column } from '../../src/shared/types';

const column: Column = { id: 'execute', projectId: 'p', name: 'Executing', position: 0, autoStart: false, agentId: 'codex', model: 'column-model', effort: 'low' };
const agents: AgentPreset[] = [
  { id: 'codex', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: null, enabled: true },
  { id: 'custom', name: 'Custom', kind: 'custom', command: 'tool', args: [], model: null, enabled: true },
];
const noop = () => undefined;

describe('workflow step controls', () => {
  it('shows per-step model and effort fields and their inherited defaults', () => {
    const html = renderToStaticMarkup(createElement(WorkflowStepRows, {
      columns: [column], agents, selectedIds: ['execute'], approvalIds: [], worktreeIds: ['execute'], parallelIds: ['execute'],
      agentByColumn: {}, modelByColumn: { execute: 'step-model' }, effortByColumn: { execute: 'high' },
      toggleStep: noop, toggleApproval: noop, toggleWorktree: noop, toggleParallel: noop, changeAgent: noop, changeModel: noop, changeEffort: noop,
    }));
    expect(html).toContain('aria-label="Modell für Executing"');
    expect(html).toContain('value="step-model"');
    expect(html).toContain('aria-label="Effort für Executing"');
    expect(html).toContain('<option value="high" selected="">High</option>');
    expect(html).toContain('aria-label="Karten-Worktree für Executing" checked=""');
    expect(html).toContain('aria-label="Karten in Executing parallel bearbeiten" checked=""');
  });

  it('disables model and effort for a manual step and keeps existing step order', () => {
    const html = renderToStaticMarkup(createElement(WorkflowStepRows, {
      columns: [column], agents, selectedIds: ['execute'], approvalIds: [], worktreeIds: ['execute'], parallelIds: [],
      agentByColumn: { execute: '' }, modelByColumn: {}, effortByColumn: {},
      toggleStep: noop, toggleApproval: noop, toggleWorktree: noop, toggleParallel: noop, changeAgent: noop, changeModel: noop, changeEffort: noop,
    }));
    expect(html).toMatch(/aria-label="Modell für Executing"[^>]*disabled/);
    expect(html).toMatch(/aria-label="Effort für Executing"[^>]*disabled/);
    expect(html).toMatch(/aria-label="Karten-Worktree für Executing"[^>]*disabled/);
    const steps = stepsFromForm([column], ['execute'], [{ id: 'old-step', columnId: 'execute', agentId: 'codex', requireApproval: false }], {}, { execute: 'step-model' }, { execute: 'high' }, ['execute']);
    expect(steps).toEqual([{ id: 'old-step', columnId: 'execute', agentId: 'codex', model: 'step-model', effort: 'high', requireApproval: true, useWorktree: false, parallel: false }]);
    expect(stepsFromForm([column], ['execute'], [], {}, {}, {}, [], ['execute'])[0]?.useWorktree).toBe(true);
    expect(stepsFromForm([column], ['execute'], [], {}, {}, {}, [], ['execute'], ['execute'])[0]?.parallel).toBe(true);
    expect(stepsFromForm([column], ['execute'], [], {}, {}, {}, [], [], ['execute'])[0]?.parallel).toBe(false);
    expect(stepsFromForm([column], ['execute'], [], { execute: '' }, {}, {}, [], ['execute'])[0]?.useWorktree).toBe(false);
  });

  it('shows a saved disabled agent instead of mislabeling the step as manual', () => {
    const html = renderToStaticMarkup(createElement(WorkflowStepRows, {
      columns: [column], agents: agents.map((item) => item.id === 'codex' ? { ...item, enabled: false } : item),
      selectedIds: ['execute'], approvalIds: [], worktreeIds: [], parallelIds: [], agentByColumn: { execute: 'codex' },
      modelByColumn: {}, effortByColumn: {},
      toggleStep: noop, toggleApproval: noop, toggleWorktree: noop, toggleParallel: noop, changeAgent: noop, changeModel: noop, changeEffort: noop,
    }));
    expect(html).toContain('<option value="codex" disabled="" selected="">Codex (deaktiviert)</option>');
    expect(html).not.toContain('<option value="" selected="">Manuell</option>');
  });
});
