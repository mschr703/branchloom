import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('usage session read', () => {
  it('reads project-scoped metadata for more than 200 stored sessions without disclosing output', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-usage-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    try {
      const project = store.createProject({ name: 'Synthetic usage', path: root });
      mkdirSync(join(root, 'other'));
      const other = store.createProject({ name: 'Other', path: join(root, 'other') });
      const agent = store.agents()[0]!;
      const column = store.snapshot(project.id).columns[0]!;
      const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Synthetic task' });
      const otherCard = store.createCard({ projectId: other.id, columnId: store.snapshot(other.id).columns[0]!.id, title: 'Other task' });
      const first = store.createSession({ cardId: card.id, agentId: agent.id });
      store.appendOutput(first.id, 'PRIVATE TOKEN MUST NOT LEAK');
      store.finishSession(first.id, 'failed', 1);
      for (let i = 0; i < 201; i += 1) {
        const run = store.createSession({ cardId: card.id, agentId: agent.id });
        store.finishSession(run.id, 'exited', 0);
      }
      store.createSession({ cardId: otherCard.id, agentId: agent.id });
      expect(store.snapshot(project.id).sessions).toHaveLength(200);
      const page = store.usageSessions({ projectId: project.id, since: new Date(Date.now() - 86_400_000).toISOString() });
      expect(page).toMatchObject({ truncated: false });
      expect(page.sessions).toHaveLength(202);
      expect(page.sessions.find((run) => run.id === first.id)).toMatchObject({ state: 'failed', exitCode: 1 });
      expect(JSON.stringify(page)).not.toContain('PRIVATE TOKEN');
      expect(page.sessions.every((run) => !('output' in run))).toBe(true);
      expect(store.usageSessions({ projectId: other.id, since: new Date(Date.now() - 86_400_000).toISOString() }).sessions).toHaveLength(1);
      expect(() => store.usageSessions({ projectId: project.id, since: 'not-a-date' })).toThrow();
      expect(() => store.usageSessions({ projectId: project.id, since: new Date(Date.now() - 36 * 86_400_000).toISOString() })).toThrow();
      expect(() => store.usageSessions({ projectId: 'missing', since: new Date(Date.now() - 86_400_000).toISOString() })).toThrow();
    } finally { store.close(); }
  });
});
