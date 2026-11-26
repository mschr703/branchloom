import type Database from 'better-sqlite3';
import type { ConnectionSignal, SessionConnectionEvent, SessionRecoveryState } from '../shared/session-recovery';
import type { StudioStore } from './store';

export function installSessionRecovery(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS session_connection_events (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    signal TEXT NOT NULL CHECK (signal IN ('online', 'offline')),
    observed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS session_connection_recent ON session_connection_events(session_id, id DESC);`);
}

/** A device-network observation is evidence about the interface, never proof that a model answered. */
export class SessionRecoveryMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSignal: ConnectionSignal | null = null;

  constructor(
    private readonly store: StudioStore,
    private readonly deviceOnline: () => boolean,
    private readonly attached: (sessionId: string) => boolean,
    private readonly pauseQueue: (projectId: string) => void,
    private readonly resumeIdleQueue: () => void = () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => { try { this.poll(); } catch { /* A later poll may recover; no CLI is restarted. */ } }, 5_000);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.lastSignal = null;
  }

  poll(): ConnectionSignal {
    const signal: ConnectionSignal = this.deviceOnline() ? 'online' : 'offline';
    const previousSignal = this.lastSignal;
    const active = this.store.db.prepare("SELECT id, project_id FROM sessions WHERE state = 'running'").all() as Array<{ id: string; project_id: string }>;
    const latest = this.store.db.prepare('SELECT signal FROM session_connection_events WHERE session_id = ? ORDER BY id DESC LIMIT 1');
    const insert = this.store.db.prepare('INSERT INTO session_connection_events (session_id, signal, observed_at) VALUES (?, ?, ?)');
    const trim = this.store.db.prepare('DELETE FROM session_connection_events WHERE session_id = ? AND id NOT IN (SELECT id FROM session_connection_events WHERE session_id = ? ORDER BY id DESC LIMIT 20)');
    this.store.db.transaction(() => {
      for (const row of active) {
        const previous = latest.get(row.id) as { signal: ConnectionSignal } | undefined;
        if (previous?.signal === signal) continue;
        insert.run(row.id, signal, new Date().toISOString());
        trim.run(row.id, row.id);
      }
      if (signal === 'offline') {
        // Leave the actual PTY alone. Its already executed writes are uncertain;
        // pause only future automatic steps and queue claims.
        const running = this.store.db.prepare("SELECT id FROM workflows WHERE state = 'running'").all() as Array<{ id: string }>;
        for (const row of running) this.store.setWorkflowState(row.id, 'paused');
        const queues = this.store.db.prepare("SELECT project_id FROM project_queues WHERE state = 'running'").all() as Array<{ project_id: string }>;
        for (const row of queues) this.pauseQueue(row.project_id);
      }
    })();
    this.lastSignal = signal;
    if (previousSignal === 'offline' && signal === 'online') this.resumeIdleQueue();
    return signal;
  }

  state(sessionId: string): SessionRecoveryState {
    const session = this.store.session(sessionId);
    const signal = this.poll();
    const interruption = this.store.db.prepare('SELECT interrupted_at FROM sessions WHERE id = ?').get(sessionId) as { interrupted_at: string | null };
    const events = this.store.db.prepare('SELECT signal, observed_at FROM session_connection_events WHERE session_id = ? ORDER BY id DESC LIMIT 20').all(sessionId) as Array<{ signal: ConnectionSignal; observed_at: string }>;
    const process = interruption.interrupted_at ? 'interrupted' : session.state !== 'running' ? 'ended' : this.attached(sessionId) ? 'attached' : 'unconfirmed';
    return { sessionId, signal, checkedAt: new Date().toISOString(), sessionState: session.state, process, events: events.map((row): SessionConnectionEvent => ({ signal: row.signal, observedAt: row.observed_at })) };
  }
}
