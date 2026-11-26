import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SessionRunner } from '../../src/main/cli';
import { TeamCoordinatorHttp } from '../../src/main/team-coordinator-http';
import { createTeamWorkspace } from '../../src/main/team-workspace';
import { StudioStore } from '../../src/main/store';

it('starts one real CLI session in a card worktree after an authorized team move', async () => {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-team-agent-run-'));
  const repo = join(root, 'repo'); mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Synthetic test']);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'synthetic@example.invalid']);
  writeFileSync(join(repo, 'README.md'), 'Synthetic repository\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md']);
  execFileSync('git', ['-C', repo, 'commit', '-qm', 'Initial synthetic commit']);
  const store = new StudioStore(join(root, 'studio.sqlite'));
  let coordinator: TeamCoordinatorHttp | null = null;
  let finish!: (id: string) => void;
  const ended = new Promise<string>((resolve) => { finish = resolve; });
  const runner = new SessionRunner(store, () => undefined, (session) => finish(session.id));
  try {
    const project = store.createProject({ name: 'Synthetic project', path: repo });
    const source = store.snapshot(project.id).columns[0]!;
    const card = store.createCard({ projectId: project.id, columnId: source.id, title: 'Run local fixture' });
    const agent = store.saveAgent({ name: 'Node fixture', kind: 'custom', command: process.execPath,
      args: ['-e', 'console.log("TEAM_AGENT_PTY_OK")'], model: null, enabled: true });
    const target = store.createColumn({ projectId: project.id, name: 'Team run', agentId: agent.id, autoStart: true });
    const owner = createTeamWorkspace(store.db, { workspaceName: 'Synthetic team', projectId: project.id, ownerName: 'Owner' });
    coordinator = new TeamCoordinatorHttp(store, (cardId, agentId) => runner.start({ cardId, agentId, prompt: '', useWorktree: true }));
    const base = await coordinator.start();
    const mutationId = randomUUID();
    const move = () => fetch(`${base}/v1/projects/${project.id}/cards/${card.id}/column`, {
      method: 'POST', headers: { Authorization: `Bearer ${owner.credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnId: target.id, expectedRevision: 0, mutationId }),
    });
    const first = await move();
    expect(first.status).toBe(200);
    const result = await first.json() as { agentLaunch: { state: string; sessionId: string } };
    expect(result.agentLaunch.state).toBe('started');
    expect(await Promise.race([ended, new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Agent did not exit')), 12_000))]))
      .toBe(result.agentLaunch.sessionId);
    const saved = store.session(result.agentLaunch.sessionId);
    expect(saved.state).toBe('exited');
    expect(saved.worktreePath).toBeTruthy();
    expect(saved.output).toContain('TEAM_AGENT_PTY_OK');
    const repeated = await move();
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toMatchObject({ repeated: true,
      agentLaunch: { state: 'started', sessionId: saved.id } });
    expect((store.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE card_id = ?').get(card.id) as { count: number }).count)
      .toBe(1);
  } finally {
    await coordinator?.close();
    runner.dispose();
    store.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}, 25_000);
