import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { IntegrationEvidence, IntegrationTestEvidence, IntegrationTestState } from '../shared/integration-evidence';
import { cardFingerprint, currentPreparedIntegration, integrationPolicy } from './integration-queue';
import type { StudioStore } from './store';
import { assertProjectCanStart } from './project-pause';

const MAX_OUTPUT = 8_000;
const TEST_TIMEOUT_MS = 180_000;
const SCRIPT_NAME = /^[a-zA-Z0-9:_-]{1,64}$/;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();

interface TestRow {
  id: number; item_id: number; card_id: string; source_head: string; target_head: string; card_fingerprint: string;
  script_name: string; script_hash: string; state: IntegrationTestState; exit_code: number | null;
  output_tail: string; started_at: string; ended_at: string | null; owner_pid: number | null;
}
interface ReviewRow { card_id: string; source_head: string; target_head: string; card_fingerprint: string; reviewed_at: string }

export function installIntegrationEvidence(store: StudioStore): void {
  store.db.exec(`CREATE TABLE IF NOT EXISTS integration_test_config (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    script_name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS integration_test_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES integration_items(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    source_head TEXT NOT NULL, target_head TEXT NOT NULL, card_fingerprint TEXT NOT NULL,
    script_name TEXT NOT NULL, script_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running','passed','failed','interrupted','stale')),
    exit_code INTEGER, output_tail TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, owner_pid INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_running_test ON integration_test_runs(item_id) WHERE state = 'running';
  CREATE INDEX IF NOT EXISTS idx_integration_test_latest ON integration_test_runs(item_id, id DESC);
  CREATE TABLE IF NOT EXISTS integration_reviews (
    item_id INTEGER PRIMARY KEY REFERENCES integration_items(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    source_head TEXT NOT NULL, target_head TEXT NOT NULL, card_fingerprint TEXT NOT NULL, reviewed_at TEXT NOT NULL
  );`);
  const running = store.db.prepare("SELECT DISTINCT item_id FROM integration_test_runs WHERE state = 'running'")
    .all() as Array<{ item_id: number }>;
  for (const row of running) reconcileRunning(store, row.item_id);
}

function alive(pid: number | null): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function reconcileRunning(store: StudioStore, itemId: number): void {
  const rows = store.db.prepare("SELECT id, owner_pid FROM integration_test_runs WHERE item_id = ? AND state = 'running'")
    .all(itemId) as Array<{ id: number; owner_pid: number | null }>;
  for (const row of rows) {
    if (alive(row.owner_pid)) continue;
    store.db.prepare("UPDATE integration_test_runs SET state = 'interrupted', ended_at = ?, output_tail = substr(output_tail || ?, -8000), owner_pid = NULL WHERE id = ? AND state = 'running'")
      .run(now(), '\n[The app stopped before this test run returned; it was not repeated.]', row.id);
  }
}

function configuredScript(store: StudioStore, projectId: string): string | null {
  return (store.db.prepare('SELECT script_name FROM integration_test_config WHERE project_id = ?').get(projectId) as { script_name: string } | undefined)?.script_name ?? null;
}

export function setIntegrationTestScript(store: StudioStore, input: { projectId: string; scriptName: string }): string | null {
  store.project(input.projectId);
  if (typeof input.scriptName !== 'string') throw new Error('Select an npm script name.');
  const name = input.scriptName.trim();
  if (name && !SCRIPT_NAME.test(name)) throw new Error('Only a simple npm script name is allowed.');
  if (!name && integrationPolicy(store, input.projectId).mode === 'automatic')
    throw new Error('Disable automatic integration before removing its required npm test.');
  if (store.projectQueue(input.projectId).autoTest && name !== configuredScript(store, input.projectId))
    throw new Error('Disable automatic queue tests before changing their npm script.');
  if (name) store.db.prepare('INSERT INTO integration_test_config (project_id, script_name) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET script_name = excluded.script_name')
    .run(input.projectId, name);
  else store.db.prepare('DELETE FROM integration_test_config WHERE project_id = ?').run(input.projectId);
  return name || null;
}

function latestTest(store: StudioStore, itemId: number): TestRow | null {
  reconcileRunning(store, itemId);
  return (store.db.prepare('SELECT * FROM integration_test_runs WHERE item_id = ? ORDER BY id DESC LIMIT 1').get(itemId) as TestRow | undefined) ?? null;
}

function evidenceCurrent(store: StudioStore, row: TestRow | ReviewRow, cardId: string, scriptName?: string): boolean {
  try {
    const prepared = currentPreparedIntegration(store, cardId);
    if (row.source_head !== prepared.item.sourceHead || row.target_head !== prepared.item.targetHead
      || row.card_fingerprint !== prepared.item.cardFingerprint || cardFingerprint(store, cardId) !== row.card_fingerprint) return false;
    if (scriptName && 'script_name' in row && row.script_name !== scriptName) return false;
    return true;
  } catch { return false; }
}

export function integrationEvidence(store: StudioStore, cardId: string): IntegrationEvidence {
  const card = store.card(cardId);
  const config = configuredScript(store, card.projectId);
  const item = store.db.prepare('SELECT id FROM integration_items WHERE card_id = ?').get(cardId) as { id: number } | undefined;
  if (!item) return { configuredScript: config, test: null, review: null };
  const row = latestTest(store, item.id);
  const review = store.db.prepare('SELECT * FROM integration_reviews WHERE item_id = ?').get(item.id) as ReviewRow | undefined;
  const test: IntegrationTestEvidence | null = row && {
    id: row.id, cardId, sourceHead: row.source_head, targetHead: row.target_head,
    cardFingerprint: row.card_fingerprint, scriptName: row.script_name, scriptHash: row.script_hash,
    state: row.state, exitCode: row.exit_code, outputTail: row.output_tail,
    startedAt: row.started_at, endedAt: row.ended_at,
    current: evidenceCurrent(store, row, cardId, config ?? undefined),
  };
  return { configuredScript: config, test,
    review: review ? { cardId, sourceHead: review.source_head, targetHead: review.target_head,
      cardFingerprint: review.card_fingerprint, reviewedAt: review.reviewed_at,
      current: evidenceCurrent(store, review, cardId) } : null };
}

/** An explicit human statement about the prepared diff, bound to the exact Git/card snapshot. */
export function attestIntegrationReview(store: StudioStore, input: { cardId: string; confirm: boolean }): IntegrationEvidence {
  if (input.confirm !== true) throw new Error('Explicit review confirmation is required.');
  const prepared = currentPreparedIntegration(store, input.cardId);
  store.db.prepare(`INSERT INTO integration_reviews (item_id, card_id, source_head, target_head, card_fingerprint, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET
    card_id = excluded.card_id, source_head = excluded.source_head, target_head = excluded.target_head,
    card_fingerprint = excluded.card_fingerprint, reviewed_at = excluded.reviewed_at`)
    .run(prepared.item.id, input.cardId, prepared.item.sourceHead, prepared.item.targetHead, prepared.item.cardFingerprint, now());
  return integrationEvidence(store, input.cardId);
}

function git(cwd: string, args: string[], emptyHooks: string): string {
  const result = spawnSync('git', ['-c', `core.hooksPath=${emptyHooks}`, '-c', 'core.fsmonitor=false', ...args], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (result.error || result.status !== 0) throw new Error('The isolated Git checkout could not be verified.');
  return result.stdout.trim();
}

function scriptDefinition(checkout: string, name: string): { body: string; lifecycleHash: string } {
  const file = join(checkout, 'package.json');
  if (!existsSync(file) || !lstatSync(file).isFile()) throw new Error('The source commit has no regular package.json.');
  const packageInfo = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, unknown> };
  const body = packageInfo.scripts?.[name];
  if (typeof body !== 'string' || !body.trim()) throw new Error(`The source commit has no npm script named ${name}.`);
  const before = packageInfo.scripts?.[`pre${name}`] ?? null;
  const after = packageInfo.scripts?.[`post${name}`] ?? null;
  if ((before !== null && typeof before !== 'string') || (after !== null && typeof after !== 'string'))
    throw new Error('The npm lifecycle scripts must be strings.');
  return { body, lifecycleHash: sha(JSON.stringify([name, before, body, after])) };
}

/** Pin the command npm actually invokes, including its implicit pre/post scripts. */
export function npmScriptApprovalHash(root: string, name: string): string {
  return scriptDefinition(root, name).lifecycleHash;
}

function testEnvironment(): NodeJS.ProcessEnv {
  const names = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'ProgramFiles(x86)'];
  const result: NodeJS.ProcessEnv = { CI: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' };
  for (const name of names) if (process.env[name]) result[name] = process.env[name];
  return result;
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
  }
}

async function runNpm(checkout: string, script: string, timeoutMs: number): Promise<{ exitCode: number | null; output: string; timedOut: boolean }> {
  const windows = process.platform === 'win32';
  const command = windows ? process.env.ComSpec || 'cmd.exe' : 'npm';
  const args = windows ? ['/d', '/s', '/c', `npm run ${script}`] : ['run', script];
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: checkout, env: testEnvironment(), windowsHide: true,
      detached: !windows, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    let settled = false;
    const collect = (chunk: Buffer) => { output = (output + chunk.toString('utf8')).slice(-MAX_OUTPUT); };
    child.stdout?.on('data', collect); child.stderr?.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolveResult({ exitCode, output: output.slice(-MAX_OUTPUT), timedOut });
    };
    child.on('error', (error) => { collect(Buffer.from(`\n[Test process error: ${error.message}]`)); finish(null); });
    child.on('close', (code) => finish(code));
  });
}

function cleanTemporaryRoot(root: string): void {
  const parent = resolve(tmpdir());
  const target = resolve(root);
  if (dirname(target) !== parent || !basename(target).startsWith('branchloom-integration-test-'))
    throw new Error('Refusing to remove an unexpected test directory.');
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

/** Run a selected npm script in a detached checkout of the prepared source commit. */
export async function runIntegrationTest(store: StudioStore, cardId: string, timeoutMs = TEST_TIMEOUT_MS,
  expectedScriptHash?: string): Promise<IntegrationTestEvidence> {
  const prepared = currentPreparedIntegration(store, cardId);
  assertProjectCanStart(store, prepared.item.projectId);
  const scriptName = configuredScript(store, prepared.item.projectId);
  if (!scriptName) throw new Error('Configure an npm test script for this project first.');
  const root = mkdtempSync(join(tmpdir(), 'branchloom-integration-test-'));
  const checkout = join(root, 'checkout');
  const emptyHooks = join(root, 'hooks');
  mkdirSync(emptyHooks);
  let worktreeAdded = false;
  let testId: number | null = null;
  try {
    git(prepared.worktreePath, ['worktree', 'add', '--detach', '--', checkout, prepared.item.sourceHead], emptyHooks);
    worktreeAdded = true;
    const script = scriptDefinition(checkout, scriptName);
    if (expectedScriptHash && script.lifecycleHash !== expectedScriptHash)
      throw new Error('The npm script changed since automatic queue tests were enabled. Review the script and enable the policy again.');
    const dependencyDir = join(prepared.worktreePath, 'node_modules');
    const dependencyLink = join(checkout, 'node_modules');
    if (existsSync(dependencyDir) && !existsSync(dependencyLink))
      symlinkSync(dependencyDir, dependencyLink, process.platform === 'win32' ? 'junction' : 'dir');
    const scriptHash = script.lifecycleHash;
    const inserted = store.db.transaction(() => {
      assertProjectCanStart(store, prepared.item.projectId);
      const fresh = currentPreparedIntegration(store, cardId);
      if (fresh.item.sourceHead !== prepared.item.sourceHead || fresh.item.targetHead !== prepared.item.targetHead
        || fresh.item.cardFingerprint !== prepared.item.cardFingerprint || configuredScript(store, fresh.item.projectId) !== scriptName)
        throw new Error('Integration changed before test start. Prepare again.');
      reconcileRunning(store, prepared.item.id);
      return store.db.prepare(`INSERT INTO integration_test_runs
        (item_id, card_id, source_head, target_head, card_fingerprint, script_name, script_hash,
         state, exit_code, output_tail, started_at, ended_at, owner_pid)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running', NULL, '', ?, NULL, ?)`).run(prepared.item.id, cardId,
        prepared.item.sourceHead, prepared.item.targetHead, prepared.item.cardFingerprint, scriptName, scriptHash, now(), process.pid);
    }).immediate();
    testId = Number(inserted.lastInsertRowid);
    const result = await runNpm(checkout, scriptName, Math.max(50, Math.min(TEST_TIMEOUT_MS, timeoutMs)));
    let state: IntegrationTestState = result.exitCode === 0 && !result.timedOut ? 'passed' : 'failed';
    let output = result.output;
    try {
      if (existsSync(dependencyLink) && lstatSync(dependencyLink).isSymbolicLink()) rmSync(dependencyLink);
      if (git(checkout, ['rev-parse', 'HEAD'], emptyHooks) !== prepared.item.sourceHead || git(checkout, ['status', '--porcelain', '--untracked-files=normal'], emptyHooks)) {
        state = 'stale'; output = (output + '\n[Test changed its isolated source checkout.]').slice(-MAX_OUTPUT);
      }
      const fresh = currentPreparedIntegration(store, cardId);
      if (fresh.item.sourceHead !== prepared.item.sourceHead || fresh.item.targetHead !== prepared.item.targetHead
        || fresh.item.cardFingerprint !== prepared.item.cardFingerprint || configuredScript(store, fresh.item.projectId) !== scriptName
        || scriptDefinition(checkout, scriptName).lifecycleHash !== scriptHash) {
        state = 'stale'; output = (output + '\n[Prepared source, target, card, or script changed during the test.]').slice(-MAX_OUTPUT);
      }
    } catch {
      state = 'stale'; output = (output + '\n[The prepared integration could not be verified after the test.]').slice(-MAX_OUTPUT);
    }
    if (result.timedOut) output = (output + '\n[Test timed out.]').slice(-MAX_OUTPUT);
    store.db.prepare('UPDATE integration_test_runs SET state = ?, exit_code = ?, output_tail = ?, ended_at = ?, owner_pid = NULL WHERE id = ? AND state = ? AND owner_pid = ?')
      .run(state, result.exitCode, output, now(), testId, 'running', process.pid);
    return integrationEvidence(store, cardId).test!;
  } catch (reason) {
    if (testId) store.db.prepare("UPDATE integration_test_runs SET state = 'failed', output_tail = ?, ended_at = ?, owner_pid = NULL WHERE id = ? AND state = 'running' AND owner_pid = ?")
      .run(String(reason instanceof Error ? reason.message : reason).slice(0, MAX_OUTPUT), now(), testId, process.pid);
    throw reason;
  } finally {
    if (worktreeAdded) {
      try { git(prepared.worktreePath, ['worktree', 'remove', '--force', '--', checkout], emptyHooks); }
      catch { /* Keep a failed cleanup's Git registration for explicit inspection. */ }
    }
    cleanTemporaryRoot(root);
  }
}
