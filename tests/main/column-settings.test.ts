import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentArgs, columnLaunchOverrides } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';
import type { AgentPreset } from '../../src/shared/types';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-column-settings-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const codex = store.agents().find((item) => item.kind === 'codex')!;
  const gemini = store.agents().find((item) => item.kind === 'gemini')!;
  const custom = store.saveAgent({ name: 'Custom', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
  return { store, path, project, codex, gemini, custom };
}

describe('column agent settings', () => {
  it('migrates existing columns and persists model and effort across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-legacy-column-'));
    roots.push(root);
    const path = join(root, 'studio.sqlite');
    const legacy = new Database(path);
    legacy.exec('CREATE TABLE columns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, auto_start INTEGER NOT NULL DEFAULT 0, agent_id TEXT)');
    legacy.close();
    const store = new StudioStore(path);
    const project = store.createProject({ name: 'Existing', path: root });
    const first = store.snapshot(project.id).columns[0]!;
    expect(first).toMatchObject({ model: null, effort: null, tint: 'default' });
    const codex = store.agents().find((item) => item.kind === 'codex')!;
    const saved = store.updateColumn({ id: first.id, agentId: codex.id, model: 'gpt-6.1-sol', effort: 'high' });
    expect(saved).toMatchObject({ agentId: codex.id, model: 'gpt-6.1-sol', effort: 'high' });
    store.close();
    const reopened = new StudioStore(path);
    expect(reopened.column(first.id)).toMatchObject({ model: 'gpt-6.1-sol', effort: 'high' });
    reopened.close();
  });

  it('persists a chosen board color and rejects unknown colors', () => {
    const { store, path, project } = fixture();
    const first = store.snapshot(project.id).columns[0]!;
    expect(store.updateColumn({ id: first.id, tint: 'coral' }).tint).toBe('coral');
    expect(() => store.updateColumn({ id: first.id, tint: 'neon' as never })).toThrow('Invalid column color');
    expect(store.column(first.id).tint).toBe('coral');
    store.close();
    const reopened = new StudioStore(path);
    expect(reopened.snapshot(project.id).columns[0]?.tint).toBe('coral');
    reopened.close();
  });

  it('validates unsupported combinations before writing column settings', () => {
    const { store, project, codex, gemini, custom } = fixture();
    const column = store.createColumn({ projectId: project.id, name: 'Custom execution', agentId: codex.id, model: 'gpt-6.1-sol', effort: 'medium' });
    expect(() => store.updateColumn({ id: column.id, agentId: gemini.id })).toThrow('nur für Codex');
    expect(store.column(column.id).agentId).toBe(codex.id);
    expect(() => store.updateColumn({ id: column.id, agentId: custom.id, model: 'other', effort: null })).toThrow('Agentenprofil');
    expect(() => store.updateColumn({ id: column.id, model: '-c', effort: null })).toThrow('Spalten-Modell');
    expect(() => store.updateColumn({ id: column.id, effort: 'impossible' as never })).toThrow('Ungültiger');
    expect(() => store.createColumn({ projectId: project.id, name: 'No agent', autoStart: true })).toThrow('Spaltenagenten');
    const noAgent = store.createColumn({ projectId: project.id, name: 'Manual' });
    expect(() => store.updateColumn({ id: noAgent.id, model: 'gpt-6.1-sol' })).toThrow('zuerst einen Spaltenagenten');
    expect(store.column(noAgent.id)).toMatchObject({ model: null, effort: null });
    const geminiColumn = store.updateColumn({ id: column.id, agentId: gemini.id, model: 'gemini-3.8-flash', effort: null });
    expect(geminiColumn).toMatchObject({ model: 'gemini-3.8-flash', effort: null });
    store.close();
  });

  it('keeps queue route column launch settings fixed until the queue is paused', () => {
    const { store, project, codex, gemini } = fixture();
    try {
      const columns = store.snapshot(project.id).columns;
      const used = store.updateColumn({ id: columns[2]!.id, agentId: codex.id, model: 'gpt-6.1-sol', effort: 'medium' });
      const unrelated = columns[1]!;
      const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Queue template' });
      const route = store.createWorkflow({ projectId: project.id, name: 'Queue route', cardIds: [card.id],
        steps: [{ id: 'execute', columnId: used.id, agentId: codex.id, requireApproval: false }] });
      store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: route.id,
        activeWorkflowId: null, pauseReason: null });

      expect(() => store.updateColumn({ id: used.id, model: 'gpt-6.1-astra' })).toThrow('Pause the project queue');
      expect(() => store.updateColumn({ id: used.id, effort: 'high' })).toThrow('Pause the project queue');
      expect(() => store.updateColumn({ id: used.id, agentId: gemini.id, model: 'gemini-3.8-flash', effort: null })).toThrow('Pause the project queue');
      expect(() => store.updateColumn({ id: used.id, autoStart: true })).toThrow('Pause the project queue');
      expect(store.column(used.id)).toMatchObject({ agentId: codex.id, model: 'gpt-6.1-sol', effort: 'medium', autoStart: false });

      expect(store.updateColumn({ id: used.id, name: 'Renamed execution' }).name).toBe('Renamed execution');
      expect(store.updateColumn({ id: unrelated.id, agentId: codex.id, model: 'gpt-6.1-sol' }).model).toBe('gpt-6.1-sol');
      expect(() => store.updateColumn({ id: unrelated.id, autoStart: true })).toThrow('Pause the project queue');
      expect(() => store.createColumn({ projectId: project.id, name: 'New auto', agentId: codex.id, autoStart: true })).toThrow('Pause the project queue');
      expect(store.createColumn({ projectId: project.id, name: 'New manual' }).autoStart).toBe(false);

      const active = store.createWorkflow({ projectId: project.id, name: 'Already claimed route', cardIds: [card.id],
        steps: [{ id: 'planning', columnId: unrelated.id, agentId: codex.id, requireApproval: false }] });
      store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: route.id,
        activeWorkflowId: active.id, pauseReason: null });
      expect(() => store.updateColumn({ id: unrelated.id, effort: 'high' })).toThrow('Pause the project queue');

      store.saveProjectQueue({ projectId: project.id, state: 'paused', templateWorkflowId: route.id,
        activeWorkflowId: active.id, pauseReason: 'Paused for settings' });
      expect(store.updateColumn({ id: used.id, model: 'gpt-6.1-astra', effort: 'high' })).toMatchObject({ model: 'gpt-6.1-astra', effort: 'high' });
      expect(store.updateColumn({ id: unrelated.id, autoStart: true }).autoStart).toBe(true);
    } finally { store.close(); }
  });

  it('builds Codex CLI flags for both interactive and workflow runs', () => {
    const agent: AgentPreset = { id: 'agent', name: 'Codex', kind: 'codex', command: 'codex', args: ['--sandbox', 'workspace-write'], model: 'profile-model', enabled: true };
    const column = { model: 'column-model', effort: 'high' as const };
    const interactive = buildAgentArgs(agent, 'Do the task', 'interactive', undefined, column);
    expect(interactive).toEqual(['--sandbox', 'workspace-write', '-m', 'column-model', '-c', 'model_reasoning_effort="high"', 'Do the task']);
    const workflow = buildAgentArgs(agent, 'Check the task', 'one-shot', 'last.txt', column);
    expect(workflow).toEqual(['exec', '--json', '--approve-for-me', '--output-last-message', 'last.txt', '-m', 'column-model', '-c', 'model_reasoning_effort="high"', 'Check the task']);
    expect(buildAgentArgs(agent, 'Other agent', 'interactive', undefined, { model: null, effort: null })).toContain('profile-model');
  });

  it('does not combine Codex auto approval with conflicting sandbox flags', () => {
    const agent: AgentPreset = { id: 'agent', name: 'Codex', kind: 'codex', command: 'codex', args: ['--sandbox=workspace-write', '--approve-for-me'], model: null, enabled: true };
    expect(buildAgentArgs(agent, 'Step', 'one-shot')).toEqual(['exec', '--json', '--approve-for-me', 'Step']);
    expect(() => buildAgentArgs({ ...agent, args: ['-s', 'read-only'] }, 'Step', 'one-shot')).toThrow('workspace-write');
    expect(() => buildAgentArgs({ ...agent, args: ['--dangerously-bypass-approvals-and-sandbox'] }, 'Step', 'one-shot')).toThrow('Sandbox-Bypass');
    expect(() => buildAgentArgs({ ...agent, args: ['--cd', 'C:\\'] }, 'Step', 'one-shot')).toThrow('Profilargument --cd');
    expect(() => buildAgentArgs({ ...agent, args: ['--add-dir', 'C:\\'] }, 'Step', 'one-shot')).toThrow('Profilargument --add-dir');
    expect(() => buildAgentArgs({ ...agent, args: ['-c', 'sandbox_permissions=["disk-full-read-access"]'] }, 'Step', 'one-shot')).toThrow('Profilargument -c');
    expect(buildAgentArgs({ ...agent, args: ['--ignore-user-config', '--skip-git-repo-check'] }, 'Step', 'one-shot'))
      .toEqual(['exec', '--json', '--approve-for-me', '--ignore-user-config', '--skip-git-repo-check', 'Step']);
  });

  it('uses column overrides only for the matching card or workflow agent', () => {
    const agent: AgentPreset = { id: 'column-agent', name: 'Codex', kind: 'codex', command: 'codex', args: [], model: 'profile-model', enabled: true };
    const column = { agentId: agent.id, model: 'column-model', effort: 'high' as const };
    expect(columnLaunchOverrides(column, agent)).toEqual({ model: 'column-model', effort: 'high' });
    const other = { ...agent, id: 'explicit-agent' };
    expect(columnLaunchOverrides(column, other)).toEqual({ model: null, effort: null });
    expect(buildAgentArgs(other, 'Step', 'one-shot', undefined, columnLaunchOverrides(column, other))).toContain('profile-model');
  });

  it('builds Antigravity CLI commands with native prompt, model and effort flags', () => {
    const agent: AgentPreset = { id: 'agy', name: 'Antigravity', kind: 'antigravity', command: 'agy', args: ['--agent', 'reviewer'], model: 'profile-model', enabled: true };
    const column = { model: 'column-model', effort: 'high' as const };
    expect(buildAgentArgs(agent, 'First turn', 'interactive', undefined, column)).toEqual(['--agent', 'reviewer', '--model', 'column-model', '--effort', 'high', '-i', 'First turn']);
    expect(buildAgentArgs(agent, 'Review changes', 'one-shot', undefined, column)).toEqual(['--agent', 'reviewer', '--model', 'column-model', '--effort', 'high', '-p', 'Review changes']);
    expect(buildAgentArgs(agent, 'Other turn', 'one-shot', undefined, { model: null, effort: null })).toEqual(['--agent', 'reviewer', '--model', 'profile-model', '-p', 'Other turn']);
    expect(() => buildAgentArgs({ ...agent, args: ['--dangerously-skip-permissions'] }, 'Task', 'one-shot')).toThrow('Permission-Bypass');
    expect(() => buildAgentArgs(agent, '', 'one-shot')).toThrow('Prompt');
  });

  it('stores Antigravity column settings and excludes its unsupported ultra effort', () => {
    const { store, project } = fixture();
    const agent = store.agents().find((item) => item.kind === 'antigravity')!;
    const column = store.createColumn({ projectId: project.id, name: 'Custom review', agentId: agent.id, model: 'gemini-3.8-flash-medium', effort: 'medium' });
    expect(columnLaunchOverrides(column, agent)).toEqual({ model: 'gemini-3.8-flash-medium', effort: 'medium' });
    expect(() => store.updateColumn({ id: column.id, effort: 'ultra' })).toThrow('max');
    store.close();
  });
});
