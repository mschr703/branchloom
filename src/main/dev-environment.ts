import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { CardDevEnvironment, DevEnvironmentProfile, DevEnvironmentState, SaveDevEnvironmentProfile } from '../shared/dev-environment';
import { ensureCardWorktree } from './git-worktree';
import type { StudioStore } from './store';

interface ProfileRow { project_id: string; executable: string; args_json: string; health_path: string; health_marker: string; updated_at: string }
interface RunRow { id: string; project_id: string; card_id: string; worktree_path: string; branch: string; port: number; pid: number | null; state: DevEnvironmentState; started_at: string; ready_at: string | null; ended_at: string | null; exit_code: number | null; output: string }
const stamp = (): string => new Date().toISOString();
const active = (state: DevEnvironmentState): boolean => state === 'starting' || state === 'ready';
const MAX_LOG = 32_000;
const START_TIMEOUT_MS = 20_000;

export function installDevEnvironments(store: StudioStore): void {
  store.db.exec(`CREATE TABLE IF NOT EXISTS dev_environment_profiles (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    executable TEXT NOT NULL, args_json TEXT NOT NULL, health_path TEXT NOT NULL,
    health_marker TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dev_environment_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    worktree_path TEXT NOT NULL, branch TEXT NOT NULL, port INTEGER NOT NULL,
    pid INTEGER, state TEXT NOT NULL CHECK (state IN ('starting','ready','failed','stopped','interrupted')),
    started_at TEXT NOT NULL, ready_at TEXT, ended_at TEXT, exit_code INTEGER, output TEXT NOT NULL DEFAULT '');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_environment_active_card ON dev_environment_runs(card_id) WHERE state IN ('starting','ready');
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dev_environment_active_port ON dev_environment_runs(port) WHERE state IN ('starting','ready');
    CREATE INDEX IF NOT EXISTS idx_dev_environment_card_history ON dev_environment_runs(card_id, started_at DESC);`);
}

export function checkedDevEnvironmentProfile(input: SaveDevEnvironmentProfile): SaveDevEnvironmentProfile {
  if (!input || typeof input.projectId !== 'string' || typeof input.executable !== 'string' || !Array.isArray(input.args)
    || !input.args.every((arg) => typeof arg === 'string') || typeof input.healthPath !== 'string' || typeof input.healthMarker !== 'string')
    throw new Error('Development profile is invalid.');
  const executable = input.executable.trim();
  if (!executable || executable.length > 260 || /[\r\n\0]/u.test(executable)) throw new Error('Choose a direct executable, such as node.');
  if (input.args.length > 24 || input.args.some((arg) => arg.length > 240 || /[\r\n\0]/u.test(arg))) throw new Error('Use at most 24 bounded arguments, one per line.');
  if (!input.args.some((arg) => arg.includes('{port}'))) throw new Error('At least one argument must contain {port}.');
  if (!input.args.some((arg) => arg.includes('127.0.0.1'))) throw new Error('Bind the development server explicitly to 127.0.0.1.');
  if (!/^\/(?!\/)[^\s?#\\]{0,199}$/u.test(input.healthPath)) throw new Error('Health path must be a local path without query or fragment.');
  const healthMarker = input.healthMarker.trim();
  if (healthMarker.length < 3 || healthMarker.length > 120 || /[\r\n\0]/u.test(healthMarker)) throw new Error('Enter a 3–120 character marker present on the ready page.');
  return { projectId: input.projectId, executable, args: input.args, healthPath: input.healthPath, healthMarker };
}

export function devEnvironmentProfile(store: StudioStore, projectId: string): DevEnvironmentProfile | null {
  store.project(projectId);
  const row = store.db.prepare('SELECT * FROM dev_environment_profiles WHERE project_id = ?').get(projectId) as ProfileRow | undefined;
  return row ? { projectId, executable: row.executable, args: JSON.parse(row.args_json) as string[], healthPath: row.health_path,
    healthMarker: row.health_marker, updatedAt: row.updated_at } : null;
}

export function saveDevEnvironmentProfile(store: StudioStore, input: SaveDevEnvironmentProfile): DevEnvironmentProfile {
  const checked = checkedDevEnvironmentProfile(input);
  store.project(checked.projectId);
  const updatedAt = stamp();
  store.db.prepare(`INSERT INTO dev_environment_profiles (project_id, executable, args_json, health_path, health_marker, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET executable = excluded.executable,
    args_json = excluded.args_json, health_path = excluded.health_path, health_marker = excluded.health_marker, updated_at = excluded.updated_at`)
    .run(checked.projectId, checked.executable, JSON.stringify(checked.args), checked.healthPath, checked.healthMarker, updatedAt);
  return { ...checked, updatedAt };
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function randomLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate a local port.')); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function ownerAlive(pid: number | null): boolean {
  if (!pid || !Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (reason) { return (reason as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

function terminateOwnedTree(child: ChildProcessWithoutNullStreams): void {
  const pid = child.pid;
  if (!pid) throw new Error('The owned process has no PID.');
  if (process.platform === 'win32') {
    // Keep the parent alive until taskkill has enumerated its descendants.
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      timeout: 8000, windowsHide: true, stdio: 'pipe', maxBuffer: 64_000,
    });
  } else {
    // POSIX children are started in their own process group below.
    process.kill(-pid, 'SIGKILL');
  }
}

function rowToRun(row: RunRow, managed: boolean): CardDevEnvironment {
  return { id: row.id, projectId: row.project_id, cardId: row.card_id, worktreePath: row.worktree_path,
    branch: row.branch, port: row.port, pid: row.pid, url: `http://127.0.0.1:${row.port}/`, state: row.state,
    startedAt: row.started_at, readyAt: row.ready_at, endedAt: row.ended_at, exitCode: row.exit_code,
    output: row.output, managed };
}

async function pageHasMarker(port: number, path: string, marker: string): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(1200) });
    if (!response.ok || response.headers.get('content-length') && Number(response.headers.get('content-length')) > 65_536) { await response.body?.cancel(); return false; }
    const reader = response.body?.getReader();
    if (!reader) return false;
    const parts: Uint8Array[] = [];
    let size = 0;
    let done = false;
    while (size < 65_536) {
      const part = await reader.read();
      if (part.done) { done = true; break; }
      size += part.value.byteLength;
      if (size > 65_536) { await reader.cancel(); return false; }
      parts.push(part.value);
    }
    if (!done) await reader.cancel();
    const text = new TextDecoder().decode(Buffer.concat(parts));
    return text.includes(marker);
  } catch { return false; }
}

/** Manual card preview process. Nothing is replayed after an app restart. */
export class DevEnvironmentRunner {
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();
  private readonly uncertainTermination = new Set<string>();
  private disposed = false;

  constructor(private readonly store: StudioStore, private readonly allocatePort: () => Promise<number> = randomLocalPort) {}

  private row(id: string): RunRow { const row = this.store.db.prepare('SELECT * FROM dev_environment_runs WHERE id = ?').get(id) as RunRow | undefined; if (!row) throw new Error('Development run was not found.'); return row; }

  private reconcile(row: RunRow): RunRow {
    if (active(row.state) && !this.children.has(row.id) && !ownerAlive(row.pid)) {
      this.store.db.prepare("UPDATE dev_environment_runs SET state = 'interrupted', ended_at = ? WHERE id = ? AND state IN ('starting','ready')").run(stamp(), row.id);
      return this.row(row.id);
    }
    return row;
  }

  card(cardId: string): CardDevEnvironment | null {
    this.store.card(cardId);
    const row = this.store.db.prepare('SELECT * FROM dev_environment_runs WHERE card_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(cardId) as RunRow | undefined;
    return row ? rowToRun(this.reconcile(row), this.children.has(row.id)) : null;
  }

  private update(id: string, state: DevEnvironmentState, exitCode: number | null = null): CardDevEnvironment {
    this.store.db.prepare('UPDATE dev_environment_runs SET state = ?, ended_at = ?, exit_code = ? WHERE id = ?').run(state, stamp(), exitCode, id);
    return rowToRun(this.row(id), this.children.has(id));
  }

  private append(id: string, chunk: string): void {
    this.store.db.prepare('UPDATE dev_environment_runs SET output = substr(output || ?, -?) WHERE id = ?').run(chunk, MAX_LOG, id);
  }

  private async waitReady(id: string, child: ChildProcessWithoutNullStreams, profile: DevEnvironmentProfile, port: number): Promise<void> {
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (!this.disposed && this.children.get(id) === child && Date.now() < deadline) {
      if (await pageHasMarker(port, profile.healthPath, profile.healthMarker)) {
        if (this.children.get(id) !== child || this.row(id).state !== 'starting') return;
        this.store.db.prepare("UPDATE dev_environment_runs SET state = 'ready', ready_at = ? WHERE id = ? AND state = 'starting'").run(stamp(), id);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (this.children.get(id) === child && this.row(id).state === 'starting') {
      this.append(id, '\n[Readiness marker was not found within 20 seconds.]\n');
      try {
        terminateOwnedTree(child);
        this.update(id, 'failed');
        this.children.delete(id);
      } catch {
        this.uncertainTermination.add(id);
        this.append(id, '[Process tree could not be stopped. Use Stop again or inspect it in Task Manager.]\n');
      }
    }
  }

  async start(cardId: string): Promise<CardDevEnvironment> {
    if (this.disposed) throw new Error('Development runner is closed.');
    const card = this.store.card(cardId);
    if (card.archivedAt) throw new Error('Restore the card before starting its development preview.');
    const profile = devEnvironmentProfile(this.store, card.projectId);
    if (!profile) throw new Error('Set a project development profile before starting a card preview.');
    const current = this.card(cardId);
    if (current && active(current.state)) throw new Error('This card already has a development run. Stop or inspect it first.');
    if (current && current.state !== 'stopped' && !await portAvailable(current.port))
      throw new Error('The previous preview still occupies its port. Inspect and stop it outside Branchloom before starting again.');
    const worktree = ensureCardWorktree(this.store, cardId);
    let row: RunRow | null = null;
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const port = await this.allocatePort();
      if (!Number.isInteger(port) || port < 1024 || port > 65_535 || !await portAvailable(port)) continue;
      try {
        const id = randomUUID();
        const startedAt = stamp();
        this.store.db.transaction(() => {
          const existing = this.store.db.prepare("SELECT 1 FROM dev_environment_runs WHERE card_id = ? AND state IN ('starting','ready')").get(cardId);
          if (existing) throw new Error('This card already has a development run.');
          this.store.db.prepare(`INSERT INTO dev_environment_runs (id, project_id, card_id, worktree_path, branch, port, state, started_at)
            VALUES (?, ?, ?, ?, ?, ?, 'starting', ?)`).run(id, card.projectId, cardId, worktree.path, worktree.branch, port, startedAt);
        }).immediate();
        row = this.row(id);
      } catch (reason) {
        if (String(reason).includes('UNIQUE constraint failed: dev_environment_runs.port')) continue;
        throw reason;
      }
    }
    if (!row) throw new Error('No free local development port was available.');
    const args = profile.args.map((arg) => arg.replaceAll('{port}', String(row!.port)));
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(profile.executable, args, { cwd: worktree.cwd, env: { ...process.env, PORT: String(row.port), HOST: '127.0.0.1', BRANCHLOOM_DEV_PORT: String(row.port) },
        shell: false, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      // A failed spawn reports asynchronously even when no PID was assigned.
      child.once('error', () => {});
      if (!child.pid) throw new Error('The configured executable could not start.');
    } catch (reason) {
      this.append(row.id, `\n[Start failed: ${reason instanceof Error ? reason.message : String(reason)}]\n`);
      this.update(row.id, 'failed');
      throw reason;
    }
    this.store.db.prepare('UPDATE dev_environment_runs SET pid = ? WHERE id = ?').run(child.pid, row.id);
    this.children.set(row.id, child);
    child.stdout.on('data', (chunk: Buffer) => { if (this.children.get(row!.id) === child) this.append(row!.id, chunk.toString('utf8')); });
    child.stderr.on('data', (chunk: Buffer) => { if (this.children.get(row!.id) === child) this.append(row!.id, chunk.toString('utf8')); });
    child.on('error', (reason) => {
      if (this.children.get(row!.id) !== child) return;
      this.append(row!.id, `\n[Process error: ${reason.message}]\n`);
      this.children.delete(row!.id);
      if (active(this.row(row!.id).state)) this.update(row!.id, 'failed');
    });
    child.on('exit', (code) => {
      if (this.children.get(row!.id) !== child) return;
      this.children.delete(row!.id);
      if (active(this.row(row!.id).state)) this.update(row!.id, this.uncertainTermination.has(row!.id) || code === 0 ? 'interrupted' : 'failed', code);
      this.uncertainTermination.delete(row!.id);
    });
    void this.waitReady(row.id, child, profile, row.port);
    return rowToRun(this.row(row.id), true);
  }

  stop(id: string): CardDevEnvironment {
    const child = this.children.get(id);
    if (!child || !active(this.row(id).state)) throw new Error('This development run is not managed or is already stopped.');
    try { terminateOwnedTree(child); }
    catch {
      this.uncertainTermination.add(id);
      this.append(id, '\n[Process tree could not be stopped. Use Stop again or inspect it in Task Manager.]\n');
      throw new Error('Could not stop the complete development process tree. Inspect it in Task Manager and retry.');
    }
    this.uncertainTermination.delete(id);
    this.update(id, 'stopped');
    this.children.delete(id);
    return rowToRun(this.row(id), false);
  }

  dispose(): void {
    for (const id of [...this.children.keys()]) {
      try { this.stop(id); }
      catch {
        this.store.db.prepare("UPDATE dev_environment_runs SET state = 'interrupted', ended_at = ? WHERE id = ?").run(stamp(), id);
        this.children.delete(id);
        this.uncertainTermination.delete(id);
      }
    }
    this.disposed = true;
  }
}
