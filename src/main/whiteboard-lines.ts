import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { WhiteboardEndMarker, WhiteboardFreeLine, WhiteboardLineStyle } from '../shared/types';
import { MAX_WHITEBOARD_FREE_LINE_LENGTH } from '../shared/whiteboard-free-line';
import type { StudioStore } from './store';

export type WhiteboardLineGeometry = Pick<WhiteboardFreeLine, 'x1' | 'y1' | 'x2' | 'y2'>;
export type CreateWhiteboardFreeLine = { projectId: string } & WhiteboardLineGeometry &
  Partial<Pick<WhiteboardFreeLine, 'lineStyle' | 'endMarker' | 'label'>>;
export type UpdateWhiteboardFreeLine = { projectId: string; id: string; expectedUpdatedAt: string } &
  Partial<WhiteboardLineGeometry & Pick<WhiteboardFreeLine, 'lineStyle' | 'endMarker' | 'label'>>;

interface LineRow {
  id: string;
  project_id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  line_style: WhiteboardLineStyle;
  end_marker: WhiteboardEndMarker;
  label: string;
  created_at: string;
  updated_at: string;
}

export const MAX_WHITEBOARD_FREE_LINES = 500;
export const MIN_WHITEBOARD_FREE_LINE_LENGTH = 8;
const MAX_COORDINATE = 100_000;

/** Separate from node-to-node edges, which can create card context. */
export function installWhiteboardFreeLines(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_free_lines (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      x1 REAL NOT NULL CHECK (x1 BETWEEN -100000 AND 100000),
      y1 REAL NOT NULL CHECK (y1 BETWEEN -100000 AND 100000),
      x2 REAL NOT NULL CHECK (x2 BETWEEN -100000 AND 100000),
      y2 REAL NOT NULL CHECK (y2 BETWEEN -100000 AND 100000),
      line_style TEXT NOT NULL CHECK (line_style IN ('solid', 'dashed')),
      end_marker TEXT NOT NULL CHECK (end_marker IN ('none', 'arrow')),
      label TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS whiteboard_free_lines_project
      ON whiteboard_free_lines(project_id, created_at, id);
  `);
}

const fromRow = (row: LineRow): WhiteboardFreeLine => ({
  id: row.id, projectId: row.project_id, x1: row.x1, y1: row.y1, x2: row.x2, y2: row.y2,
  lineStyle: row.line_style, endMarker: row.end_marker, label: row.label,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

function coordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE)
    throw new Error('Whiteboard line coordinate is invalid.');
  return Math.round(value * 100) / 100;
}

function geometry(input: WhiteboardLineGeometry): WhiteboardLineGeometry {
  const result = { x1: coordinate(input.x1), y1: coordinate(input.y1), x2: coordinate(input.x2), y2: coordinate(input.y2) };
  if (Math.hypot(result.x2 - result.x1, result.y2 - result.y1) < MIN_WHITEBOARD_FREE_LINE_LENGTH)
    throw new Error('Whiteboard line is too short.');
  if (Math.hypot(result.x2 - result.x1, result.y2 - result.y1) > MAX_WHITEBOARD_FREE_LINE_LENGTH)
    throw new Error('Whiteboard line is too long.');
  return result;
}

function lineStyle(value: unknown): WhiteboardLineStyle {
  if (value !== 'solid' && value !== 'dashed') throw new Error('Whiteboard line style is invalid.');
  return value;
}

function endMarker(value: unknown): WhiteboardEndMarker {
  if (value !== 'none' && value !== 'arrow') throw new Error('Whiteboard line end marker is invalid.');
  return value;
}

function lineLabel(value: unknown): string {
  if (typeof value !== 'string' || value.length > 120 || value.includes('\0'))
    throw new Error('Whiteboard line label is invalid.');
  return value.trim();
}

function lineForProject(store: StudioStore, projectId: string, id: string): LineRow {
  const row = store.db.prepare('SELECT * FROM whiteboard_free_lines WHERE id = ? AND project_id = ?').get(id, projectId) as LineRow | undefined;
  if (!row) throw new Error('Whiteboard line not found in this project.');
  return row;
}

export function whiteboardFreeLines(store: StudioStore, projectId: string): WhiteboardFreeLine[] {
  store.project(projectId);
  return (store.db.prepare('SELECT * FROM whiteboard_free_lines WHERE project_id = ? ORDER BY created_at, id LIMIT ?')
    .all(projectId, MAX_WHITEBOARD_FREE_LINES) as LineRow[]).map(fromRow);
}

export function createWhiteboardFreeLine(store: StudioStore, input: CreateWhiteboardFreeLine): WhiteboardFreeLine {
  return store.db.transaction(() => {
    store.project(input.projectId);
    const coordinates = geometry(input);
    const style = lineStyle(input.lineStyle === undefined ? 'solid' : input.lineStyle);
    const marker = endMarker(input.endMarker === undefined ? 'none' : input.endMarker);
    const label = lineLabel(input.label === undefined ? '' : input.label);
    const { count } = store.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_free_lines WHERE project_id = ?')
      .get(input.projectId) as { count: number };
    if (count >= MAX_WHITEBOARD_FREE_LINES) throw new Error(`At most ${MAX_WHITEBOARD_FREE_LINES} Whiteboard lines per project.`);
    const stamp = new Date().toISOString();
    const id = randomUUID();
    store.db.prepare('INSERT INTO whiteboard_free_lines (id, project_id, x1, y1, x2, y2, line_style, end_marker, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, input.projectId, coordinates.x1, coordinates.y1, coordinates.x2, coordinates.y2, style, marker, label, stamp, stamp);
    return fromRow(lineForProject(store, input.projectId, id));
  })();
}

export function updateWhiteboardFreeLine(store: StudioStore, input: UpdateWhiteboardFreeLine): WhiteboardFreeLine {
  return store.db.transaction(() => {
    const existing = lineForProject(store, input.projectId, input.id);
    if (input.expectedUpdatedAt !== existing.updated_at) throw new Error('Whiteboard line changed since the draft. Reload and try again.');
    const coordinates = geometry({ x1: input.x1 === undefined ? existing.x1 : input.x1,
      y1: input.y1 === undefined ? existing.y1 : input.y1,
      x2: input.x2 === undefined ? existing.x2 : input.x2,
      y2: input.y2 === undefined ? existing.y2 : input.y2 });
    const style = lineStyle(input.lineStyle === undefined ? existing.line_style : input.lineStyle);
    const marker = endMarker(input.endMarker === undefined ? existing.end_marker : input.endMarker);
    const label = lineLabel(input.label === undefined ? existing.label : input.label);
    const stamp = new Date(Math.max(Date.now(), Date.parse(existing.updated_at) + 1)).toISOString();
    store.db.prepare('UPDATE whiteboard_free_lines SET x1 = ?, y1 = ?, x2 = ?, y2 = ?, line_style = ?, end_marker = ?, label = ?, updated_at = ? WHERE id = ? AND project_id = ?')
      .run(coordinates.x1, coordinates.y1, coordinates.x2, coordinates.y2, style, marker, label, stamp, input.id, input.projectId);
    return fromRow(lineForProject(store, input.projectId, input.id));
  })();
}

export function deleteWhiteboardFreeLine(store: StudioStore, input: { projectId: string; id: string; expectedUpdatedAt: string }): void {
  store.db.transaction(() => {
    const existing = lineForProject(store, input.projectId, input.id);
    if (input.expectedUpdatedAt !== existing.updated_at) throw new Error('Whiteboard line changed since the draft. Reload and try again.');
    store.db.prepare('DELETE FROM whiteboard_free_lines WHERE id = ? AND project_id = ?').run(input.id, input.projectId);
  })();
}
