import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { resolveExecutable } from '../../src/main/cli';
import { discussProject } from '../../src/main/project-chat';
import { StudioStore } from '../../src/main/store';

const liveIt = process.env.JARVIS_STUDIO_LIVE_CODEX === '1' ? it : it.skip;

liveIt('answers from a synthetic card with a real read-only CLI call', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-live-project-chat-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  try {
    execFileSync('git', ['init', root], { stdio: 'ignore' });
    const project = store.createProject({ name: 'Synthetic review project', path: root });
    const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id,
      title: 'Review preview FERN-42', description: 'The desktop preview is done. Mobile QA is open.' });
    const executable = resolveExecutable('codex');
    if (!executable) throw new Error('Codex CLI unavailable');
    const agent = store.saveAgent({ name: 'Codex', kind: 'codex', command: executable, args: [], model: null, enabled: true });
    store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: 'low' });
    const answer = await discussProject(store, { projectId: project.id, turns: [{ role: 'user', text: 'What is the status of review preview FERN-42?' }] });
    expect(answer.answer).toContain('Mobile');
    expect(answer.sources.some((source) => source.cardId === card.id)).toBe(true);
    expect(store.snapshot(project.id).cards).toHaveLength(1);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 120_000);
