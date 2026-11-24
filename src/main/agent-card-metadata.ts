import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentCardMetadataAudit } from '../shared/agent-card-metadata';
import type { Card, CardPriority } from '../shared/types';
import { cardLabels, cardPriority } from '../shared/card-metadata';
import type { StudioStore } from './store';

interface AuditRow {
  id: string; project_id: string; card_id: string; session_id: string; agent_id: string;
  agent_name: string; before_priority: CardPriority; after_priority: CardPriority;
  before_labels_json: string; after_labels_json: string; reason: string; changed_at: string;
}

export function installAgentCardMetadata(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_card_metadata_policy (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS agent_card_metadata_audit (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id), agent_name TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE, before_priority TEXT NOT NULL, after_priority TEXT NOT NULL,
    before_labels_json TEXT NOT NULL, after_labels_json TEXT NOT NULL,
    reason TEXT NOT NULL, changed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agent_card_metadata_audit_project
    ON agent_card_metadata_audit(project_id, changed_at DESC);`);
}

export function agentCardMetadataEnabled(store: StudioStore, projectId: string): boolean {
  store.project(projectId);
  const row = store.db.prepare('SELECT enabled FROM agent_card_metadata_policy WHERE project_id = ?').get(projectId) as { enabled: number } | undefined;
  return row?.enabled === 1;
}

export function setAgentCardMetadataEnabled(store: StudioStore, input: { projectId: string; enabled: boolean }): boolean {
  if (typeof input?.enabled !== 'boolean') throw new Error('Agent card metadata permission must be a boolean.');
  store.project(input.projectId);
  store.db.prepare('INSERT INTO agent_card_metadata_policy (project_id, enabled) VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET enabled = excluded.enabled')
    .run(input.projectId, input.enabled ? 1 : 0);
  return input.enabled;
}

export function cardMetadataFingerprint(card: Card): string {
  return createHash('sha256').update(JSON.stringify([
    card.id, card.projectId, card.columnId, card.title, card.description,
    card.priority, card.labels, card.updatedAt, card.archivedAt,
  ])).digest('hex');
}

export function projectLabels(store: StudioStore, projectId: string): string[] {
  store.project(projectId);
  const rows = store.db.prepare('SELECT labels_json FROM cards WHERE project_id = ? AND archived_at IS NULL').all(projectId) as Array<{ labels_json: string }>;
  return [...new Set(rows.flatMap((row) => JSON.parse(row.labels_json) as string[]))].sort((a, b) => a.localeCompare(b));
}

export function agentCardMetadataAudit(store: StudioStore, projectId: string, limit = 30): AgentCardMetadataAudit[] {
  store.project(projectId);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Audit limit must be between 1 and 100.');
  const rows = store.db.prepare(`SELECT * FROM agent_card_metadata_audit WHERE project_id = ?
    ORDER BY changed_at DESC, rowid DESC LIMIT ?`).all(projectId, limit) as AuditRow[];
  return rows.map((row) => ({ id: row.id, projectId: row.project_id, cardId: row.card_id,
    sessionId: row.session_id, agentId: row.agent_id, agentName: row.agent_name,
    beforePriority: row.before_priority, afterPriority: row.after_priority,
    beforeLabels: JSON.parse(row.before_labels_json) as string[], afterLabels: JSON.parse(row.after_labels_json) as string[],
    reason: row.reason, changedAt: row.changed_at }));
}

export function updateAgentCardMetadata(store: StudioStore, input: {
  sessionId: string; requestId: string; expectedFingerprint: string;
  priority?: CardPriority; labels?: string[]; reason: string;
}): { card: Card; fingerprint: string; audit: AgentCardMetadataAudit } {
  if (!input || typeof input.sessionId !== 'string' || typeof input.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.requestId) || typeof input.expectedFingerprint !== 'string'
    || !/^[0-9a-f]{64}$/i.test(input.expectedFingerprint)) throw new Error('Invalid metadata request.');
  if (input.priority === undefined && input.labels === undefined) throw new Error('Priority or labels are required.');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500 || /\0/.test(input.reason)) throw new Error('A short reason is required.');
  const priority = input.priority === undefined ? undefined : cardPriority(input.priority);
  const labels = input.labels === undefined ? undefined : cardLabels(input.labels);
  return store.db.transaction(() => {
    const session = store.session(input.sessionId);
    if (session.state !== 'running') throw new Error('The agent session is no longer running.');
    if (!agentCardMetadataEnabled(store, session.projectId)) throw new Error('Agent card metadata changes are disabled for this project.');
    const agent = store.agent(session.agentId);
    if (!agent.enabled) throw new Error('The agent profile is disabled.');
    const old = store.card(session.cardId);
    if (old.projectId !== session.projectId || old.archivedAt) throw new Error('The session card is unavailable.');
    if (cardMetadataFingerprint(old) !== input.expectedFingerprint) throw new Error('Card metadata is stale. Read the current card before retrying.');
    if (store.db.prepare('SELECT 1 FROM agent_card_metadata_audit WHERE request_id = ?').get(input.requestId)) throw new Error('This metadata request was already applied.');
    const nextPriority = priority ?? old.priority;
    const nextLabels = labels ?? old.labels;
    if (nextPriority === old.priority && JSON.stringify(nextLabels) === JSON.stringify(old.labels)) throw new Error('Metadata is unchanged.');
    const card = store.updateCard({ id: old.id, priority: nextPriority, labels: nextLabels });
    const audit: AgentCardMetadataAudit = {
      id: randomUUID(), projectId: old.projectId, cardId: old.id, sessionId: session.id,
      agentId: agent.id, agentName: agent.name, beforePriority: old.priority, afterPriority: card.priority,
      beforeLabels: old.labels, afterLabels: card.labels, reason: input.reason.trim(), changedAt: new Date().toISOString(),
    };
    store.db.prepare(`INSERT INTO agent_card_metadata_audit
      (id, project_id, card_id, session_id, agent_id, agent_name, request_id,
       before_priority, after_priority, before_labels_json, after_labels_json, reason, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      audit.id, audit.projectId, audit.cardId, audit.sessionId, audit.agentId, audit.agentName,
      input.requestId, audit.beforePriority, audit.afterPriority,
      JSON.stringify(audit.beforeLabels), JSON.stringify(audit.afterLabels), audit.reason, audit.changedAt,
    );
    return { card, fingerprint: cardMetadataFingerprint(card), audit };
  })();
}
