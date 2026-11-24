import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AgentCardMetadataBridge } from '../../src/main/agent-card-metadata-bridge';
import { agentCardMetadataAudit, setAgentCardMetadataEnabled } from '../../src/main/agent-card-metadata';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

it.skipIf(process.env.BRANCHLOOM_RUN_LIVE_METADATA !== '1')('accepts an actual Codex CLI decision and tool call for synthetic card metadata', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-live-meta-'));
  const store = new StudioStore(join(root, 'studio.sqlite'));
  const project = store.createProject({ name: 'Synthetic live tool check', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  const card = store.createCard({ projectId: project.id, columnId: column.id,
    title: 'Review a synthetic deadline', description: 'This synthetic task is due tomorrow and needs review.' });
  const agent = store.saveAgent({ name: 'Codex CLI live check', kind: 'codex', command: 'codex',
    args: ['--skip-git-repo-check'], model: null, enabled: true });
  setAgentCardMetadataEnabled(store, { projectId: project.id, enabled: true });
  const bridge = new AgentCardMetadataBridge(store, () => undefined);
  await bridge.start();
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  const runner = new SessionRunner(store, () => undefined, () => resolveFinished(), bridge);
  try {
    const session = runner.start({ cardId: card.id, agentId: agent.id, mode: 'one-shot',
      prompt: 'This is a synthetic Branchloom integration test. Assess this card from its description. Use the available card metadata tool to set a fitting priority and one short review label. Do not change any files. Keep the answer brief.' });
    await Promise.race([finished, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Codex CLI timed out')), 120_000))]);
    const result = store.session(session.id);
    const updated = store.card(card.id);
    expect(result.state).toBe('exited');
    expect(updated.priority).not.toBe('none');
    expect(updated.labels.length).toBeGreaterThan(0);
    expect(agentCardMetadataAudit(store, project.id)).toHaveLength(1);
  } finally {
    runner.dispose();
    bridge.close();
    store.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}, 130_000);
