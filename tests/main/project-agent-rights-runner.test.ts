import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pty = vi.hoisted(() => ({ spawn: vi.fn((..._args: unknown[]) => ({ onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }), kill() {} })) }));
vi.mock('node-pty', () => ({ spawn: pty.spawn }));

import { SessionRunner } from '../../src/main/cli';
import { setProjectCodexWorkflowAccess } from '../../src/main/project-agent-rights';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { pty.spawn.mockClear(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); });

describe('Codex workflow access at the actual session boundary', () => {
  it('reads the persisted project mode for each new one-shot run', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-agent-rights-runner-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    const project = store.createProject({ name: 'Synthetic', path: root });
    const columnId = store.snapshot(project.id).columns[0]!.id;
    const first = store.createCard({ projectId: project.id, columnId, title: 'First' });
    const second = store.createCard({ projectId: project.id, columnId, title: 'Second' });
    const agent = store.saveAgent({ name: 'Synthetic Codex', kind: 'codex', command: process.execPath, args: [], model: null, enabled: true });
    const runner = new SessionRunner(store, () => undefined, () => undefined);
    try {
      const firstSession = runner.start({ cardId: first.id, agentId: agent.id, mode: 'one-shot', prompt: 'Synthetic task' });
      const firstArgs = pty.spawn.mock.calls[0]?.[1] as string[];
      expect(firstArgs).toContain('--approve-for-me');
      expect(firstArgs).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      runner.stop(firstSession.id);
      setProjectCodexWorkflowAccess(store, { projectId: project.id, mode: 'full' });
      runner.start({ cardId: second.id, agentId: agent.id, mode: 'one-shot', prompt: 'Synthetic task' });
      const secondArgs = pty.spawn.mock.calls[1]?.[1] as string[];
      expect(secondArgs).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(secondArgs).not.toContain('--approve-for-me');
    } finally { runner.dispose(); store.close(); }
  });
});
