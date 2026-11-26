import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-agent-freeze-'));
  roots.push(root);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = store.createCard({ projectId: project.id, columnId, title: 'Queued task' });
  const agent = store.saveAgent({ name: 'Synthetic CLI', kind: 'custom', command: process.execPath,
    args: ['--safe'], model: null, enabled: true });
  const route = store.createWorkflow({ projectId: project.id, name: 'Synthetic route', cardIds: [card.id],
    steps: [{ id: 'run', columnId, agentId: agent.id, requireApproval: false }] });
  return { store, project, card, columnId, agent, route };
}

describe('agent presets used by an active queue', () => {
  it('freezes launcher settings while the queue is idle, but allows a name edit and later changes after pause', () => {
    const { store, project, agent, route } = fixture();
    try {
      store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: route.id,
        activeWorkflowId: null, pauseReason: null });
      expect(store.activeSessionForProject(project.id)).toBeNull();
      for (const change of [
        { args: ['--changed'] }, { command: 'other-cli' }, { model: 'other-model' }, { enabled: false },
      ]) {
        expect(() => store.saveAgent({ ...agent, ...change })).toThrow('Pause the project queue');
      }
      expect(store.agent(agent.id)).toMatchObject({ command: process.execPath, args: ['--safe'], model: null, enabled: true });
      expect(store.saveAgent({ ...agent, name: 'Renamed CLI' }).name).toBe('Renamed CLI');
      const unrelated = store.saveAgent({ name: 'Unrelated CLI', kind: 'custom', command: process.execPath,
        args: [], model: null, enabled: true });
      expect(store.saveAgent({ ...unrelated, args: ['--new'] }).args).toEqual(['--new']);
      store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: route.id,
        activeWorkflowId: null, pauseReason: 'Synthetic pause' });
      expect(store.saveAgent({ ...agent, args: ['--changed'] }).args).toEqual(['--changed']);
    } finally { store.close(); }
  });

  it('also freezes an agent used only by the active workflow', () => {
    const { store, project, card, columnId, agent, route } = fixture();
    try {
      const activeAgent = store.saveAgent({ name: 'Active CLI', kind: 'custom', command: process.execPath,
        args: [], model: null, enabled: true });
      const active = store.createWorkflow({ projectId: project.id, name: 'Active route', cardIds: [card.id],
        steps: [{ id: 'active', columnId, agentId: activeAgent.id, requireApproval: false }] });
      store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: route.id,
        activeWorkflowId: active.id, pauseReason: null });
      expect(() => store.saveAgent({ ...activeAgent, args: ['--changed'] })).toThrow('Pause the project queue');
      expect(() => store.saveAgent({ ...agent, args: ['--changed'] })).toThrow('Pause the project queue');
    } finally { store.close(); }
  });
});
