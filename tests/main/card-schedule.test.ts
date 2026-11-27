import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-card-schedule-'));
  roots.push(root);
  const path = join(root, 'studio.sqlite');
  const store = new StudioStore(path);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columns = store.snapshot(project.id).columns;
  const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Build the page' });
  return { root, path, store, project, columns, card };
}

describe('card schedule', () => {
  it('keeps a plan distinct from an explicit completion after moving a card', () => {
    const { store, columns, card } = fixture();
    expect(store.updateCard({ id: card.id, plannedDueDate: '2026-12-04' }).plannedDueDate).toBe('2026-12-04');
    expect(store.moveCard({ id: card.id, columnId: columns.at(-1)!.id }).completedAt).toBeNull();
    const completed = store.setCardCompleted({ id: card.id, completed: true });
    expect(new Date(completed.completedAt!).toISOString()).toBe(completed.completedAt);
    expect(completed.plannedDueDate).toBe('2026-12-04');
    expect(store.cardScheduleEvents(card.id).map((event) => event.kind)).toEqual(['completion', 'planned-date']);
    store.close();
  });

  it('records edits and undo, but does not create duplicate history for unchanged values', () => {
    const { store, card } = fixture();
    store.updateCard({ id: card.id, plannedDueDate: '2026-12-04' });
    store.updateCard({ id: card.id, plannedDueDate: '2026-12-04' });
    store.updateCard({ id: card.id, plannedDueDate: '2026-12-05' });
    store.setCardCompleted({ id: card.id, completed: true });
    store.setCardCompleted({ id: card.id, completed: true });
    store.setCardCompleted({ id: card.id, completed: false });
    expect(store.card(card.id).completedAt).toBeNull();
    const history = store.cardScheduleEvents(card.id);
    expect(history).toHaveLength(4);
    expect(history.find((event) => event.kind === 'planned-date' && event.after === '2026-12-05')).toMatchObject({ before: '2026-12-04' });
    expect(history.find((event) => event.kind === 'completion' && event.after === null)?.before).toMatch(/^\d{4}-/);
    store.close();
  });

  it('rejects invalid dates without changing a saved plan', () => {
    const { store, card } = fixture();
    store.updateCard({ id: card.id, plannedDueDate: '2026-12-04' });
    for (const invalid of ['2026-02-30', '2026-13-01', 'tomorrow', '2026-12-04T12:00:00Z']) {
      expect(() => store.updateCard({ id: card.id, plannedDueDate: invalid })).toThrow('Kalendertag');
    }
    expect(store.card(card.id).plannedDueDate).toBe('2026-12-04');
    expect(store.cardScheduleEvents(card.id)).toHaveLength(1);
    store.close();
  });

  it('migrates an older cards table without inventing completion dates', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-legacy-schedule-'));
    roots.push(root);
    const path = join(root, 'legacy.sqlite');
    const db = new Database(path);
    db.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE columns (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, position INTEGER NOT NULL, auto_start INTEGER NOT NULL DEFAULT 0, agent_id TEXT);
      CREATE TABLE cards (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, column_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);
    `);
    const stamp = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run('p', 'Legacy', root, stamp);
    db.prepare('INSERT INTO columns VALUES (?, ?, ?, ?, ?, ?)').run('todo', 'p', 'Done', 0, 0, null);
    db.prepare('INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('old', 'p', 'todo', 'Old card', '', 0, stamp, stamp, null);
    db.close();
    const store = new StudioStore(path);
    expect(store.card('old')).toMatchObject({ plannedDueDate: null, completedAt: null });
    expect(store.cardScheduleEvents('old')).toEqual([]);
    store.updateCard({ id: 'old', plannedDueDate: '2026-12-04' });
    store.close();
    const reopened = new StudioStore(path);
    expect(reopened.card('old')).toMatchObject({ plannedDueDate: '2026-12-04', completedAt: null });
    expect(reopened.cardScheduleEvents('old')).toHaveLength(1);
    reopened.close();
  });
});
