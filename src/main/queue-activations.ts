import type Database from 'better-sqlite3';

/** Track explicit queue activations across internal updates, safe pause, and app restart. */
export function installQueueActivations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS queue_activations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    end_state TEXT CHECK (end_state IN ('paused', 'off')),
    end_reason TEXT,
    run_until TEXT,
    template_workflow_id TEXT,
    continue_blocked INTEGER NOT NULL CHECK (continue_blocked IN (0, 1))
  );
  CREATE INDEX IF NOT EXISTS idx_queue_activations_project ON queue_activations(project_id, started_at DESC, id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_activations_open ON queue_activations(project_id) WHERE ended_at IS NULL;`);

  const columns = db.pragma('table_info(queue_runs)') as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'activation_id')) {
    db.exec('ALTER TABLE queue_runs ADD COLUMN activation_id TEXT REFERENCES queue_activations(id) ON DELETE SET NULL');
  }

  db.exec(`CREATE TRIGGER IF NOT EXISTS queue_activation_initial
    AFTER INSERT ON project_queues WHEN NEW.state = 'running'
    BEGIN
      INSERT INTO queue_activations VALUES (lower(hex(randomblob(16))), NEW.project_id, NEW.updated_at,
        NULL, NULL, NULL, NEW.run_until, NEW.template_workflow_id, NEW.continue_blocked);
    END;
  CREATE TRIGGER IF NOT EXISTS queue_activation_start
    AFTER UPDATE OF state ON project_queues WHEN OLD.state <> 'running' AND NEW.state = 'running'
    BEGIN
      INSERT INTO queue_activations VALUES (lower(hex(randomblob(16))), NEW.project_id, NEW.updated_at,
        NULL, NULL, NULL, NEW.run_until, NEW.template_workflow_id, NEW.continue_blocked);
    END;
  CREATE TRIGGER IF NOT EXISTS queue_activation_end
    AFTER UPDATE OF state ON project_queues WHEN OLD.state = 'running' AND NEW.state <> 'running'
    BEGIN
      UPDATE queue_activations SET ended_at = NEW.updated_at, end_state = NEW.state,
        end_reason = NEW.pause_reason
        WHERE id = (SELECT id FROM queue_activations WHERE project_id = NEW.project_id
          AND ended_at IS NULL ORDER BY rowid DESC LIMIT 1);
    END;`);
}
