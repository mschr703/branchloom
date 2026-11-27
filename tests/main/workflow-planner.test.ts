import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkflowProposal } from '../../src/shared/types';
import { StudioStore } from '../../src/main/store';
import { executePlanner, proposeWorkflow, type PlannerInvocation } from '../../src/main/workflow-planner';
import { createWhiteboardNode } from '../../src/main/whiteboard';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-plan-test-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic public project', path: root });
  const columns = store.snapshot(project.id).columns;
  const agent = store.saveAgent({ name: 'Codex planner', kind: 'codex', command: process.execPath, args: ['--dangerously-bypass-approvals-and-sandbox'], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: 'gpt-6-sol', effort: 'high' });
  const proposal: WorkflowProposal = {
    title: 'A reviewable feature', explanation: 'Implement and test it.',
    cards: [{ title: 'Implement', description: 'Make the feature work.' }, { title: 'Verify', description: 'Check real behavior.' }],
    columnIds: [columns[2]!.id, columns[4]!.id],
  };
  return { store, root, project, columns, agent, proposal };
}

describe('global workflow agent', () => {
  it('persists settings, proposes without side effects, and accepts atomically', async () => {
    const { store, root, project, columns, agent, proposal } = fixture();
    writeFileSync(join(root, 'README.md'), 'Only the README contains marker: PLAN-COPPER-83.\n');
    writeFileSync(join(root, '.env'), 'PRIVATE_VALUE=not-for-planner\n');
    const savedSketch = createWhiteboardNode(store, { projectId: project.id, title: 'Saved architecture sketch', description: 'Synthetic planned UI', x: 10, y: 20 });
    let invocation!: PlannerInvocation;
    const result = await proposeWorkflow(store, { projectId: project.id, request: 'Build a small feature' }, async (call) => {
      invocation = call;
      writeFileSync(call.outputPath, JSON.stringify(proposal));
    });
    expect(result).toEqual(proposal);
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    expect(store.snapshot(project.id).workflows).toHaveLength(0);
    expect(invocation.cwd).not.toBe(root);
    expect(invocation.cwd).toContain('jarvis-studio-plan-');
    expect(invocation.args).toContain('--sandbox');
    expect(invocation.args).toContain('read-only');
    expect(invocation.args).toContain('--ignore-user-config');
    expect(invocation.args).toContain('--ephemeral');
    expect(invocation.args).toContain('gpt-6-sol');
    expect(invocation.args).toContain('model_reasoning_effort="high"');
    expect(invocation.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(invocation.args.at(-1)).toBe('-');
    expect(invocation.stdin).toContain('Build a small feature');
    expect(invocation.stdin).toContain('PLAN-COPPER-83');
    expect(invocation.stdin).toContain(`[whiteboard:${savedSketch.id}]`);
    expect(invocation.stdin).not.toContain('not-for-planner');
    expect(invocation.stdin).not.toContain('Another private project');

    const workflow = store.acceptWorkflowProposal({ projectId: project.id, proposal: result });
    expect(workflow.cardIds).toHaveLength(2);
    expect(workflow.state).toBe('draft');
    expect(workflow.steps.map((step) => step.columnId)).toEqual(proposal.columnIds);
    expect(store.snapshot(project.id).cards.map((card) => card.title)).toEqual(['Implement', 'Verify']);
    expect(store.snapshot(project.id).cards.every((card) => card.columnId === columns[0]!.id)).toBe(true);
    expect(store.workflowAgentSettings()).toEqual({ agentId: agent.id, model: 'gpt-6-sol', effort: 'high' });
    store.close();
  });

  it('rejects malformed model output and foreign project columns before creating cards', async () => {
    const { store, project, proposal } = fixture();
    await expect(proposeWorkflow(store, { projectId: project.id, request: 'Build' }, async (call) => {
      writeFileSync(call.outputPath, '```json\n{}\n```');
    })).rejects.toThrow('invalid JSON');
    await expect(proposeWorkflow(store, { projectId: project.id, request: 'Build' }, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ ...proposal, columnIds: ['foreign-column'] }));
    })).rejects.toThrow('unknown or duplicate column');
    expect(() => store.acceptWorkflowProposal({ projectId: project.id, proposal: { ...proposal, cards: [...proposal.cards, { title: '', description: '' }] } })).toThrow('title is invalid');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    expect(store.snapshot(project.id).workflows).toHaveLength(0);
    store.close();
  });

  it('supplies real board card references and rejects an invented source citation', async () => {
    const { store, project, columns, proposal } = fixture();
    const existing = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Existing login card' });
    let prompt = '';
    const cited = await proposeWorkflow(store, { projectId: project.id, request: 'Plan account settings' }, async (call) => {
      prompt = call.stdin ?? '';
      writeFileSync(call.outputPath, JSON.stringify({ ...proposal,
        explanation: `Keep the existing task [card:${existing.id}], then review in [column:${columns[4]!.id}].` }));
    });
    expect(prompt).toContain(existing.id);
    expect(prompt).toContain('Existing login card');
    expect(cited.explanation).toContain(`[card:${existing.id}]`);
    await expect(proposeWorkflow(store, { projectId: project.id, request: 'Plan account settings' }, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ ...proposal, explanation: 'See [card:fictional-id].' }));
    })).rejects.toThrow('not supplied');
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    store.close();
  });

  it('refuses invalid requests and unsupported agents rather than silently ignoring effort', async () => {
    const { store, project } = fixture();
    await expect(proposeWorkflow(store, { projectId: project.id, request: ' '.repeat(10) }, async () => undefined)).rejects.toThrow('request');
    await expect(proposeWorkflow(store, { projectId: project.id, request: 'x'.repeat(8001) }, async () => undefined)).rejects.toThrow('request');
    const claude = store.saveAgent({ name: 'Claude', kind: 'claude', command: process.execPath, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: claude.id, model: null, effort: 'high' });
    await expect(proposeWorkflow(store, { projectId: project.id, request: 'Build' }, async () => undefined)).rejects.toThrow('supports Codex CLI');
    store.close();
  });

  it('keeps global settings across restart', () => {
    const { store, root, agent } = fixture();
    store.close();
    const reopened = new StudioStore(join(root, 'studio.sqlite'));
    expect(reopened.workflowAgentSettings()).toEqual({ agentId: agent.id, model: 'gpt-6-sol', effort: 'high' });
    reopened.close();
  });

  it('handles a CLI exiting before a large stdin prompt is written', async () => {
    const { store, root } = fixture();
    await expect(executePlanner({ executable: process.execPath, args: ['-e', 'process.exit(2)'], cwd: root,
      outputPath: join(root, 'no-output.json'), stdin: 'x'.repeat(1_000_000) })).rejects.toThrow('Workflow agent failed');
    store.close();
  });
});
