import type Database from 'better-sqlite3';
import type { CodexWorkflowAccessMode, ProjectCodexWorkflowAccess } from '../shared/project-agent-rights';
import type { StudioStore } from './store';

export function installProjectAgentRights(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS project_codex_workflow_access (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('workspace', 'full')),
    updated_at TEXT NOT NULL
  );`);
}

export function projectCodexWorkflowAccess(store: StudioStore, projectId: string): ProjectCodexWorkflowAccess {
  store.project(projectId);
  const row = store.db.prepare('SELECT mode FROM project_codex_workflow_access WHERE project_id = ?')
    .get(projectId) as { mode: CodexWorkflowAccessMode } | undefined;
  return { projectId, mode: row?.mode ?? 'workspace' };
}

export function setProjectCodexWorkflowAccess(store: StudioStore, input: ProjectCodexWorkflowAccess): ProjectCodexWorkflowAccess {
  if (!input || typeof input.projectId !== 'string' || !['workspace', 'full'].includes(input.mode)) {
    throw new Error('Invalid Codex workflow access mode.');
  }
  return store.db.transaction(() => {
    store.project(input.projectId);
    if (store.projectQueue(input.projectId).state === 'running') {
      throw new Error('Pause the project queue before changing Codex workflow access.');
    }
    store.db.prepare(`INSERT INTO project_codex_workflow_access (project_id, mode, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`)
      .run(input.projectId, input.mode, new Date().toISOString());
    return projectCodexWorkflowAccess(store, input.projectId);
  }).immediate();
}
