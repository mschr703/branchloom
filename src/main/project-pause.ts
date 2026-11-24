import type Database from 'better-sqlite3';
import type { ProjectRunPause, ProjectRunPauseActivity } from '../shared/types';
import type { StudioStore } from './store';

const PAUSE_MESSAGE = 'Projekt ist sicher angehalten. Erst das Projekt bewusst fortsetzen.';

function ownerAlive(pid: number | null): boolean {
  if (!pid || !Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

export function installProjectRunPause(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS project_run_pauses (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    requested_at TEXT NOT NULL
  );`);
}

export function projectPauseRequested(store: StudioStore, projectId: string): boolean {
  return Boolean(store.db.prepare('SELECT 1 FROM project_run_pauses WHERE project_id = ?').get(projectId));
}

export function assertProjectCanStart(store: StudioStore, projectId: string): void {
  if (projectPauseRequested(store, projectId)) throw new Error(PAUSE_MESSAGE);
}

function runningActivity(store: StudioStore, projectId: string): ProjectRunPauseActivity[] {
  const agents = store.db.prepare(`SELECT session.id, card.id AS card_id, card.title, session.started_at
    FROM sessions session JOIN cards card ON card.id = session.card_id
    WHERE session.project_id = ? AND session.state = 'running'`).all(projectId) as Array<{
    id: string; card_id: string; title: string; started_at: string;
  }>;
  const tests = store.db.prepare(`SELECT test.id, test.card_id, card.title, test.started_at
    FROM integration_test_runs test JOIN integration_items item ON item.id = test.item_id
    JOIN cards card ON card.id = test.card_id
    WHERE item.project_id = ? AND test.state = 'running'`).all(projectId) as Array<{
    id: number; card_id: string; title: string; started_at: string;
  }>;
  const integrations = store.db.prepare(`SELECT item.id, item.card_id, card.title, item.updated_at, item.owner_pid
    FROM integration_items item JOIN cards card ON card.id = item.card_id
    WHERE item.project_id = ? AND item.state = 'integrating'`).all(projectId) as Array<{
    id: number; card_id: string; title: string; updated_at: string; owner_pid: number | null;
  }>;
  return [
    ...agents.map((row) => ({ kind: 'agent' as const, id: row.id, cardId: row.card_id, title: row.title, startedAt: row.started_at })),
    ...tests.map((row) => ({ kind: 'integration-test' as const, id: String(row.id), cardId: row.card_id, title: row.title, startedAt: row.started_at })),
    ...integrations.filter((row) => ownerAlive(row.owner_pid)).map((row) => ({ kind: 'integration' as const, id: String(row.id), cardId: row.card_id, title: row.title, startedAt: row.updated_at })),
  ].sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

/** The requested state persists; the final paused state is derived from actual work. */
export function projectRunPause(store: StudioStore, projectId: string): ProjectRunPause {
  store.project(projectId);
  const request = store.db.prepare('SELECT requested_at FROM project_run_pauses WHERE project_id = ?')
    .get(projectId) as { requested_at: string } | undefined;
  const running = runningActivity(store, projectId);
  return { projectId, state: !request ? 'active' : running.length ? 'requested' : 'paused',
    requestedAt: request?.requested_at ?? null, running };
}

/** Never stop a live process. Queue retries and future claims are disabled in the same transaction. */
export function setProjectRunPause(store: StudioStore, input: { projectId: string; paused: boolean }): ProjectRunPause {
  if (!input || typeof input.projectId !== 'string' || typeof input.paused !== 'boolean') throw new Error('Invalid project pause request.');
  return store.db.transaction(() => {
    store.project(input.projectId);
    if (input.paused) {
      store.db.prepare('INSERT OR IGNORE INTO project_run_pauses (project_id, requested_at) VALUES (?, ?)')
        .run(input.projectId, new Date().toISOString());
      store.db.prepare('DELETE FROM queue_launch_retries WHERE project_id = ?').run(input.projectId);
      store.db.prepare(`UPDATE project_queues SET state = 'paused', pause_reason = ?, updated_at = ?
        WHERE project_id = ? AND state = 'running'`)
        .run('Projektweite sichere Pause angefordert. Ergebnisse laufender Arbeit prüfen und Queue bewusst fortsetzen.', new Date().toISOString(), input.projectId);
      // This is a state transition only. Calling WorkflowEngine.setState here
      // would kill live PTYs, which is deliberately not part of safe pause.
      store.db.prepare(`UPDATE workflows SET state = 'paused', updated_at = ?
        WHERE project_id = ? AND state = 'running'`)
        .run(new Date().toISOString(), input.projectId);
    } else {
      const state = projectRunPause(store, input.projectId);
      if (state.state === 'requested') throw new Error('Warte auf das Ende der laufenden Arbeit, bevor du das Projekt fortsetzt.');
      store.db.prepare('DELETE FROM project_run_pauses WHERE project_id = ?').run(input.projectId);
    }
    return projectRunPause(store, input.projectId);
  }).immediate();
}
