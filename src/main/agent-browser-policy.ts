import type Database from 'better-sqlite3';
import type { AgentBrowserPolicy } from '../shared/agent-browser';
import type { StudioStore } from './store';

export function checkedAgentBrowserOrigin(value: string): string {
  if (typeof value !== 'string' || value.length > 160 || /[\s\u0000-\u001f]/u.test(value)) throw new Error('Enter a local development origin.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Enter a valid local development origin.'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('Only an exact http://127.0.0.1:port origin is supported.');
  }
  return url.origin;
}

export function checkedAgentBrowserPath(value: string): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 300 || /[\s\u0000-\u001f?#]/u.test(value)) {
    throw new Error('Use a local path beginning with /, without a query or fragment.');
  }
  return value;
}

export function installAgentBrowserPolicy(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_browser_policy (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    origin TEXT NOT NULL
  );`);
}

export function agentBrowserPolicy(store: StudioStore, projectId: string): AgentBrowserPolicy {
  store.project(projectId);
  const row = store.db.prepare('SELECT enabled, origin FROM agent_browser_policy WHERE project_id = ?').get(projectId) as { enabled: number; origin: string } | undefined;
  return { projectId, enabled: row?.enabled === 1, origin: row?.origin ?? '' };
}

export function setAgentBrowserPolicy(store: StudioStore, input: AgentBrowserPolicy): AgentBrowserPolicy {
  if (!input || typeof input.enabled !== 'boolean' || typeof input.origin !== 'string') throw new Error('Agent browser policy is invalid.');
  store.project(input.projectId);
  const origin = input.origin.trim() ? checkedAgentBrowserOrigin(input.origin.trim()) : '';
  if (input.enabled && !origin) throw new Error('Set a local development origin before enabling agent inspection.');
  store.db.prepare('INSERT INTO agent_browser_policy (project_id, enabled, origin) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET enabled = excluded.enabled, origin = excluded.origin')
    .run(input.projectId, input.enabled ? 1 : 0, origin);
  return { projectId: input.projectId, enabled: input.enabled, origin };
}
