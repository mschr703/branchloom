import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SessionRunner } from '../../src/main/cli';
import { queueTestMatchesActiveStart, ProjectQueueEngine } from '../../src/main/queue';
import { StudioStore } from '../../src/main/store';
import { WorkflowEngine } from '../../src/main/workflows';

const roots: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('automatic queue test receipt provenance', () => {
  it('rejects a previous activation after an explicit pause and restart while allowing a fresh manual receipt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    const root = mkdtempSync(join(tmpdir(), 'branchloom-test-start-binding-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    const project = store.createProject({ name: 'Synthetic', path: root });
    const columns = store.snapshot(project.id).columns;
    const agent = store.agents().find((item) => item.kind === 'codex')!;
    const templateCard = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Template only' });
    const template = store.createWorkflow({ projectId: project.id, name: 'Synthetic route', cardIds: [templateCard.id],
      steps: [{ id: 'execute', columnId: columns[2]!.id, agentId: agent.id, requireApproval: false }] });
    const workflows = new WorkflowEngine(store, { start: () => { throw new Error('No card should be claimed'); } } as unknown as SessionRunner);
    const queue = new ProjectQueueEngine(store, workflows);
    try {
      queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
      const first = store.db.prepare('SELECT id FROM queue_activations WHERE project_id = ? AND ended_at IS NULL').get(project.id) as { id: string };
      expect(queueTestMatchesActiveStart(store, project.id, { queueActivationId: first.id, startedAt: '2026-11-26T05:00:00.000Z' })).toBe(true);
      vi.advanceTimersByTime(500);
      queue.setState({ projectId: project.id, state: 'paused' });
      expect(queueTestMatchesActiveStart(store, project.id, { queueActivationId: first.id, startedAt: '2026-11-26T05:00:00.000Z' })).toBe(false);
      vi.advanceTimersByTime(500);
      queue.setState({ projectId: project.id, state: 'running', templateWorkflowId: template.id });
      const second = store.db.prepare('SELECT id FROM queue_activations WHERE project_id = ? AND ended_at IS NULL').get(project.id) as { id: string };
      expect(second.id).not.toBe(first.id);
      expect(queueTestMatchesActiveStart(store, project.id, { queueActivationId: first.id, startedAt: '2026-11-26T05:00:00.000Z' })).toBe(false);
      expect(queueTestMatchesActiveStart(store, project.id, { queueActivationId: second.id, startedAt: '2026-11-26T05:00:00.000Z' })).toBe(true);
      expect(queueTestMatchesActiveStart(store, project.id, { queueActivationId: null, startedAt: '2026-11-26T05:00:00.000Z' })).toBe(false);
      expect(queueTestMatchesActiveStart(store, project.id, { queueActivationId: null, startedAt: '2026-11-26T05:00:00.500Z' })).toBe(false);
      expect(queueTestMatchesActiveStart(store, project.id, { queueActivationId: null, startedAt: '2026-11-26T05:00:00.501Z' })).toBe(true);
    } finally { queue.dispose(); store.close(); }
  });
});
