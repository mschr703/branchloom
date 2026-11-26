import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { installQueueActivations } from '../../src/main/queue-activations';

it('upgrades an existing queue schema without assigning old claims to a new start', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);
      CREATE TABLE project_queues (project_id TEXT PRIMARY KEY, state TEXT NOT NULL,
        updated_at TEXT NOT NULL, pause_reason TEXT, run_until TEXT,
        template_workflow_id TEXT, continue_blocked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE queue_runs (project_id TEXT NOT NULL, card_id TEXT NOT NULL, workflow_id TEXT NOT NULL);
      INSERT INTO projects VALUES ('p');
      INSERT INTO queue_runs VALUES ('p', 'old-card', 'old-flow');`);
    installQueueActivations(db);
    installQueueActivations(db);
    expect((db.prepare('SELECT activation_id FROM queue_runs WHERE card_id = ?').get('old-card') as { activation_id: string | null }).activation_id).toBeNull();

    db.prepare('INSERT INTO project_queues VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('p', 'running', '2026-11-26T01:00:00.000Z', null, null, 'template', 1);
    const start = db.prepare('SELECT * FROM queue_activations WHERE project_id = ?').get('p') as {
      id: string; started_at: string; ended_at: string | null; continue_blocked: number;
    };
    expect(start).toMatchObject({ started_at: '2026-11-26T01:00:00.000Z', ended_at: null, continue_blocked: 1 });
    db.prepare('UPDATE project_queues SET state = ?, pause_reason = ?, updated_at = ? WHERE project_id = ?')
      .run('paused', 'App restarted', '2026-11-26T01:01:00.000Z', 'p');
    expect(db.prepare('SELECT end_state, end_reason FROM queue_activations WHERE id = ?').get(start.id))
      .toEqual({ end_state: 'paused', end_reason: 'App restarted' });
  } finally {
    db.close();
  }
});
