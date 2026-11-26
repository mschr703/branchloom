import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAgentArgs } from '../../src/main/cli';
import { projectCodexWorkflowAccess, setProjectCodexWorkflowAccess } from '../../src/main/project-agent-rights';
import { StudioStore } from '../../src/main/store';
import type { AgentPreset } from '../../src/shared/types';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-agent-rights-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  return { store, project, dbPath };
}

describe('explicit project Codex workflow access', () => {
  it('defaults to workspace and persists a selected mode only for that project', () => {
    const { store, project, dbPath } = fixture();
    const otherPath = join(project.path, 'other');
    mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(projectCodexWorkflowAccess(store, project.id).mode).toBe('workspace');
    expect(() => setProjectCodexWorkflowAccess(store, { projectId: project.id, mode: 'full' })).toThrow('Explicit acknowledgement');
    expect(setProjectCodexWorkflowAccess(store, { projectId: project.id, mode: 'full', acknowledgeFullAccess: true })).toMatchObject({ projectId: project.id, mode: 'full' });
    expect(projectCodexWorkflowAccess(store, other.id).mode).toBe('workspace');
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(projectCodexWorkflowAccess(reopened, project.id).mode).toBe('full');
    expect(projectCodexWorkflowAccess(reopened, other.id).mode).toBe('workspace');
    reopened.close();
  });

  it('rejects invalid values and changes during an active queue', () => {
    const { store, project } = fixture();
    expect(() => setProjectCodexWorkflowAccess(store, { projectId: project.id, mode: 'unsafe' as never })).toThrow('Invalid');
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => setProjectCodexWorkflowAccess(store, { projectId: project.id, mode: 'full', acknowledgeFullAccess: true })).toThrow('Pause the project queue');
    expect(projectCodexWorkflowAccess(store, project.id).mode).toBe('workspace');
    store.close();
  });

  it('generates the full access flag only for an opted-in Codex one-shot run', () => {
    const codex: AgentPreset = { id: 'codex', name: 'Codex', kind: 'codex', command: 'codex', args: ['--sandbox', 'workspace-write'], model: null, enabled: true };
    expect(buildAgentArgs(codex, 'Synthetic task', 'one-shot')).toEqual(['exec', '--json', '--approve-for-me', 'Synthetic task']);
    const full = buildAgentArgs(codex, 'Synthetic task', 'one-shot', undefined, undefined, 'full');
    expect(full).toEqual(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', 'Synthetic task']);
    expect(buildAgentArgs(codex, 'Synthetic task', 'interactive', undefined, undefined, 'full')).toEqual(['--sandbox', 'workspace-write', 'Synthetic task']);
    expect(() => buildAgentArgs({ ...codex, args: ['--dangerously-bypass-approvals-and-sandbox'] }, 'Task', 'one-shot', undefined, undefined, 'full')).toThrow('Sandbox-Bypass');
  });
});
