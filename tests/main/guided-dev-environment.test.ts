import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DevEnvironmentRunner, devEnvironmentAudit, devEnvironmentProfile, saveDevEnvironmentProfile, startApprovedDevEnvironment } from '../../src/main/dev-environment';
import { GuidedDevEnvironment, inspectDevEnvironment } from '../../src/main/guided-dev-environment';
import { StudioStore } from '../../src/main/store';
import type { PlannerInvocation } from '../../src/main/workflow-planner';

const roots: string[] = [];
const stores: StudioStore[] = [];
const runners: DevEnvironmentRunner[] = [];
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose();
  for (const store of stores.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}, 30_000);

function git(cwd: string, ...args: string[]): void { execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' }); }

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-guided-dev-')); roots.push(root);
  const repo = join(root, 'repo'); const data = join(root, 'data'); mkdirSync(repo); mkdirSync(data);
  git(repo, 'init', '-q'); git(repo, 'config', 'user.name', 'Synthetic'); git(repo, 'config', 'user.email', 'synthetic@example.invalid');
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'synthetic-shop', scripts: { dev: 'vite' }, devDependencies: { vite: '^7.0.0' } }));
  writeFileSync(join(repo, 'index.html'), '<!doctype html><title>Synthetic Shop</title>');
  const binary = join(repo, 'node_modules', 'vite', 'bin'); mkdirSync(binary, { recursive: true });
  writeFileSync(join(binary, 'vite.js'), `const http=require('node:http');const port=Number(process.argv[process.argv.indexOf('--port')+1]);
    http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<title>Synthetic Shop</title>')}).listen(port,'127.0.0.1');`);
  git(repo, 'add', '-f', 'package.json', 'index.html', 'node_modules/vite/bin/vite.js'); git(repo, 'commit', '-qm', 'synthetic Vite app');
  const dbPath = join(data, 'studio.sqlite');
  const store = new StudioStore(dbPath); stores.push(store);
  const project = store.createProject({ name: 'Synthetic shop', path: repo });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const card = store.createCard({ projectId: project.id, columnId, title: 'Shop preview' });
  const other = store.createCard({ projectId: project.id, columnId, title: 'Other preview' });
  const agent = store.saveAgent({ name: 'Codex guide', kind: 'codex', command: process.execPath, args: [], model: null, enabled: true });
  store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: 'high' });
  const runner = new DevEnvironmentRunner(store); runners.push(runner);
  return { root, repo, dbPath, store, project, card, other, runner };
}

async function ready(runner: DevEnvironmentRunner, cardId: string) {
  for (let attempt = 0; attempt < 70; attempt++) {
    const run = runner.card(cardId);
    if (run?.state === 'ready' || run?.state === 'failed') return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Synthetic preview did not settle.');
}

describe('guided development preview setup', () => {
  it.skipIf(process.env.BRANCHLOOM_LIVE_CODEX !== '1')('uses live Codex advice, one confirmed profile and two independent card previews', async () => {
    const f = fixture();
    const agent = f.store.saveAgent({ name: 'Installed Codex', kind: 'codex', command: 'codex',
      args: [], model: null, enabled: true });
    f.store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: 'low' });
    const guide = new GuidedDevEnvironment(f.store, f.runner);
    const advice = await guide.advise({ projectId: f.project.id, cardId: f.card.id });
    expect(advice.candidateId).toBe(advice.inspection.candidates[0]?.id);
    expect(advice.diagnosis).toBeTruthy();
    expect(advice.nextStep).toBeTruthy();
    expect(devEnvironmentProfile(f.store, f.project.id)).toBeNull();
    expect(f.runner.card(f.card.id)).toBeNull();
    expect(devEnvironmentAudit(f.store, f.project.id, f.card.id)).toEqual([]);
    const saved = guide.apply({ adviceId: advice.id, projectId: f.project.id, cardId: f.card.id });
    expect(devEnvironmentProfile(f.store, f.project.id)?.fingerprint).toBe(saved.fingerprint);
    const first = await startApprovedDevEnvironment(f.store, f.runner, { cardId: f.card.id,
      expectedProfileFingerprint: saved.fingerprint });
    const second = await startApprovedDevEnvironment(f.store, f.runner, { cardId: f.other.id,
      expectedProfileFingerprint: saved.fingerprint });
    expect((await ready(f.runner, f.card.id))?.state).toBe('ready');
    expect((await ready(f.runner, f.other.id))?.state).toBe('ready');
    expect(first.port).not.toBe(second.port);
    expect(first.worktreePath).not.toBe(second.worktreePath);
    expect(await (await fetch(first.url)).text()).toContain('Synthetic Shop');
    expect(await (await fetch(second.url)).text()).toContain('Synthetic Shop');
    f.runner.stop(first.id);
    expect(f.runner.card(f.other.id)?.state).toBe('ready');
    f.runner.stop(second.id);
  });

  it('uses standalone transport for an app-bundled Windows Codex CLI', async () => {
    if (process.platform !== 'win32') return;
    const f = fixture();
    const packaged = join(f.root, 'WindowsApps', 'OpenAI.Codex_1.0.0', 'app', 'resources', 'codex.exe');
    mkdirSync(join(f.root, 'WindowsApps', 'OpenAI.Codex_1.0.0', 'app', 'resources'), { recursive: true });
    writeFileSync(packaged, 'synthetic executable');
    const agent = f.store.saveAgent({ name: 'Packaged Codex', kind: 'codex', command: packaged,
      args: [], model: null, enabled: true });
    f.store.saveWorkflowAgentSettings({ agentId: agent.id, model: null, effort: 'high' });
    const input = { projectId: f.project.id, cardId: f.card.id };
    const candidate = inspectDevEnvironment(f.store, f.runner, input).candidates[0]!;
    let invocation!: PlannerInvocation;
    const guide = new GuidedDevEnvironment(f.store, f.runner, async (call) => {
      invocation = call;
      writeFileSync(call.outputPath, JSON.stringify({ candidateId: candidate.id, diagnosis: 'Source-backed Vite setup.',
        nextStep: 'Review the profile.', citedEvidenceIds: candidate.evidenceIds }));
    });
    await guide.advise(input);
    expect(invocation.executable).toBe(packaged);
    expect(invocation.args.slice(0, 2)).toEqual(['--no-daemon', 'exec']);
    expect(invocation.args).toContain('read-only');
  });

  it('selects only a Git HEAD-backed candidate, saves on confirmation, records the start click and survives restart', async () => {
    const f = fixture();
    const input = { projectId: f.project.id, cardId: f.card.id };
    const inspected = inspectDevEnvironment(f.store, f.runner, input);
    expect(inspected.candidates).toHaveLength(1);
    expect(inspected.evidence.map((item) => item.id)).toEqual(['git-head', 'package-dev', 'html-title']);
    let invocation!: PlannerInvocation;
    const guide = new GuidedDevEnvironment(f.store, f.runner, async (call) => {
      invocation = call;
      writeFileSync(call.outputPath, JSON.stringify({ candidateId: inspected.candidates[0]!.id,
        diagnosis: 'Vite ist im Git-Stand belegt.', nextStep: 'Prüfe die Abhängigkeiten im Karten-Worktree.',
        citedEvidenceIds: ['git-head', 'package-dev', 'html-title'] }));
    });
    const advice = await guide.advise(input);
    expect(advice.candidateId).toBe(inspected.candidates[0]!.id);
    expect(invocation.args).toContain('read-only');
    expect(invocation.args).toContain('--ignore-user-config');
    expect(invocation.cwd).not.toBe(f.repo);
    expect(invocation.stdin).not.toContain(f.root);
    expect(devEnvironmentProfile(f.store, f.project.id)).toBeNull();
    expect(devEnvironmentAudit(f.store, f.project.id, f.card.id)).toEqual([]);
    const saved = guide.apply({ ...input, adviceId: advice.id });
    expect(saved.executable).toBe('node');
    expect(saved.args).toEqual(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '{port}']);
    expect(devEnvironmentAudit(f.store, f.project.id, f.card.id)[0]).toMatchObject({ kind: 'profile', source: 'guided', outcome: 'saved' });
    await expect(startApprovedDevEnvironment(f.store, f.runner, { cardId: f.card.id, expectedProfileFingerprint: 'stale' })).rejects.toThrow('changed');
    expect(f.runner.card(f.card.id)).toBeNull();
    const launched = await startApprovedDevEnvironment(f.store, f.runner, { cardId: f.card.id, expectedProfileFingerprint: saved.fingerprint });
    expect((await ready(f.runner, f.card.id))?.state).toBe('ready');
    expect(await (await fetch(launched.url)).text()).toContain('Synthetic Shop');
    expect(devEnvironmentAudit(f.store, f.project.id, f.card.id)[0]).toMatchObject({ kind: 'start', outcome: 'started', runId: launched.id });
    f.runner.stop(launched.id);
    runners.splice(runners.indexOf(f.runner), 1); f.runner.dispose();
    f.store.close(); stores.splice(stores.indexOf(f.store), 1);
    const reopened = new StudioStore(f.dbPath); stores.push(reopened);
    expect(devEnvironmentProfile(reopened, f.project.id)?.fingerprint).toBe(saved.fingerprint);
    expect(devEnvironmentAudit(reopened, f.project.id, f.card.id).map((entry) => entry.kind)).toEqual(['start', 'profile']);
    expect(reopened.db.prepare('SELECT COUNT(*) AS count FROM dev_environment_runs WHERE card_id = ?').get(f.card.id)).toMatchObject({ count: 1 });
    const restartedRunner = new DevEnvironmentRunner(reopened); runners.push(restartedRunner);
    const second = await startApprovedDevEnvironment(reopened, restartedRunner, {
      cardId: f.other.id, expectedProfileFingerprint: devEnvironmentProfile(reopened, f.project.id)!.fingerprint,
    });
    expect((await ready(restartedRunner, f.other.id))?.state).toBe('ready');
    expect(second.cardId).toBe(f.other.id);
    expect(second.port).not.toBe(launched.port);
    expect(second.worktreePath).not.toBe(launched.worktreePath);
    expect(await (await fetch(second.url)).text()).toContain('Synthetic Shop');
    expect(devEnvironmentAudit(reopened, f.project.id, f.other.id).map((entry) => entry.kind)).toEqual(['start', 'profile']);
    restartedRunner.stop(second.id);
  });

  it('rejects unsupported model commands and stale source evidence before changing the profile', async () => {
    const f = fixture(); const input = { projectId: f.project.id, cardId: f.card.id };
    const guide = new GuidedDevEnvironment(f.store, f.runner, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ candidateId: 'npm install && rm -rf', diagnosis: 'Try this', nextStep: 'Try it', citedEvidenceIds: ['git-head'] }));
    });
    await expect(guide.advise(input)).rejects.toThrow('unsupported candidate');
    expect(devEnvironmentProfile(f.store, f.project.id)).toBeNull();
    const commandAdvice = new GuidedDevEnvironment(f.store, f.runner, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ candidateId: 'none', diagnosis: 'A dependency is missing.',
        nextStep: 'npm install && continue', citedEvidenceIds: ['git-head'] }));
    });
    await expect(commandAdvice.advise(input)).rejects.toThrow('shell action');
    const good = new GuidedDevEnvironment(f.store, f.runner, async (call) => {
      writeFileSync(call.outputPath, JSON.stringify({ candidateId: inspectDevEnvironment(f.store, f.runner, input).candidates[0]!.id,
        diagnosis: 'Source-backed proposal', nextStep: 'Review the profile.', citedEvidenceIds: ['git-head', 'package-dev', 'html-title'] }));
    });
    const advice = await good.advise(input);
    writeFileSync(join(f.repo, 'index.html'), '<!doctype html><title>Changed Shop</title>');
    git(f.repo, 'add', 'index.html'); git(f.repo, 'commit', '-qm', 'change preview title');
    expect(() => good.apply({ ...input, adviceId: advice.id })).toThrow('changed');
    expect(devEnvironmentProfile(f.store, f.project.id)).toBeNull();
    expect(devEnvironmentAudit(f.store, f.project.id, f.card.id)).toEqual([]);
  });

  it('classifies a failed run without sending raw process output to the agent and records rejected starts', async () => {
    const f = fixture(); const input = { projectId: f.project.id, cardId: f.card.id };
    saveDevEnvironmentProfile(f.store, { projectId: f.project.id, executable: 'missing-synthetic-executable',
      args: ['--host', '127.0.0.1', '--port', '{port}'], healthPath: '/', healthMarker: 'Synthetic Shop' });
    await expect(startApprovedDevEnvironment(f.store, f.runner, { cardId: f.card.id,
      expectedProfileFingerprint: devEnvironmentProfile(f.store, f.project.id)!.fingerprint })).rejects.toThrow();
    expect(devEnvironmentAudit(f.store, f.project.id, f.card.id)[0]).toMatchObject({ kind: 'start', outcome: 'rejected' });
    f.store.db.prepare("UPDATE dev_environment_runs SET output = '[Cannot find module SECRET_RAW_OUTPUT]' WHERE card_id = ?").run(f.card.id);
    let prompt = '';
    const guide = new GuidedDevEnvironment(f.store, f.runner, async (call) => {
      prompt = call.stdin ?? '';
      writeFileSync(call.outputPath, JSON.stringify({ candidateId: 'none', diagnosis: 'A dependency is missing.',
        nextStep: 'Check the worktree dependencies manually.', citedEvidenceIds: ['last-run'] }));
    });
    const advice = await guide.advise(input);
    expect(advice.inspection.failureKind).toBe('missing-dependency');
    expect(advice.inspection.profileMismatch).toContain('executable');
    expect(prompt).toContain('missing-dependency');
    expect(prompt).not.toContain('SECRET_RAW_OUTPUT');
    expect(() => guide.apply({ ...input, adviceId: advice.id })).toThrow('did not select');
    expect(devEnvironmentProfile(f.store, f.project.id)?.executable).toBe('missing-synthetic-executable');
    expect(devEnvironmentAudit(f.store, f.project.id, f.other.id).filter((entry) => entry.kind === 'start')).toEqual([]);
  });
});
