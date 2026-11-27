import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { MAX_WHITEBOARD_FREE_LINE_LENGTH } from '../../src/shared/whiteboard-free-line';
import {
  MAX_WHITEBOARD_FREE_LINES, MIN_WHITEBOARD_FREE_LINE_LENGTH,
  createWhiteboardFreeLine, deleteWhiteboardFreeLine, installWhiteboardFreeLines,
  updateWhiteboardFreeLine, whiteboardFreeLines,
} from '../../src/main/whiteboard-lines';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-free-lines-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const folder = join(root, 'project');
  mkdirSync(folder);
  const project = store.createProject({ name: 'Synthetic lines', path: folder });
  return { root, file, store, project };
}

const geometry = { x1: 10, y1: 20, x2: 110, y2: 80 };

describe('standalone Whiteboard lines', () => {
  it('installs the separate table on store startup and retains lines across restart', () => {
    const { file, store, project } = fixture();
    const created = createWhiteboardFreeLine(store, { projectId: project.id, ...geometry, lineStyle: 'dashed', endMarker: 'arrow', label: 'Evidence' });
    expect(created).toMatchObject({ projectId: project.id, ...geometry, lineStyle: 'dashed', endMarker: 'arrow', label: 'Evidence' });
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_edges').get()).toMatchObject({ count: 0 });
    store.close();
    const reopened = new StudioStore(file);
    installWhiteboardFreeLines(reopened.db);
    expect(whiteboardFreeLines(reopened, project.id)).toMatchObject([{ id: created.id, lineStyle: 'dashed', endMarker: 'arrow', label: 'Evidence' }]);
    reopened.close();
  });

  it('rejects malformed, excessive and imperceptibly short geometry', () => {
    const { store, project } = fixture();
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 100_001, '20']) {
      expect(() => createWhiteboardFreeLine(store, { projectId: project.id, ...geometry, x2: value as number })).toThrow('coordinate');
    }
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, x1: 0, y1: 0, x2: MIN_WHITEBOARD_FREE_LINE_LENGTH - 0.01, y2: 0 })).toThrow('too short');
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, x1: 3, y1: 3, x2: 3, y2: 3 })).toThrow('too short');
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, x1: 0, y1: 0, x2: MAX_WHITEBOARD_FREE_LINE_LENGTH + 1, y2: 0 })).toThrow('too long');
    expect(whiteboardFreeLines(store, project.id)).toEqual([]);
    store.close();
  });

  it('validates style, marker and label before writing', () => {
    const { store, project } = fixture();
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, ...geometry, lineStyle: 'wavy' as 'solid' })).toThrow('style');
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, ...geometry, endMarker: 'circle' as 'none' })).toThrow('marker');
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, ...geometry, lineStyle: null as unknown as 'solid' })).toThrow('style');
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, ...geometry, label: 'x'.repeat(121) })).toThrow('label');
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, ...geometry, label: 'bad\0text' })).toThrow('label');
    expect(whiteboardFreeLines(store, project.id)).toEqual([]);
    store.close();
  });

  it('persists updates, rejects stale writes and deletion, and keeps a line independent of edges', () => {
    const { store, project } = fixture();
    const first = createWhiteboardFreeLine(store, { projectId: project.id, ...geometry });
    const changed = updateWhiteboardFreeLine(store, { projectId: project.id, id: first.id, expectedUpdatedAt: first.updatedAt,
      x2: 160.128, lineStyle: 'dashed', endMarker: 'arrow', label: '   Review path   ' });
    expect(changed).toMatchObject({ x2: 160.13, lineStyle: 'dashed', endMarker: 'arrow', label: 'Review path' });
    expect(changed.updatedAt).not.toBe(first.updatedAt);
    expect(() => updateWhiteboardFreeLine(store, { projectId: project.id, id: first.id, expectedUpdatedAt: first.updatedAt, label: 'stale' })).toThrow('changed since');
    expect(() => updateWhiteboardFreeLine(store, { projectId: project.id, id: first.id, expectedUpdatedAt: changed.updatedAt, x2: null as unknown as number })).toThrow('coordinate');
    expect(() => deleteWhiteboardFreeLine(store, { projectId: project.id, id: first.id, expectedUpdatedAt: first.updatedAt })).toThrow('changed since');
    expect(whiteboardFreeLines(store, project.id)).toMatchObject([{ id: first.id, label: 'Review path' }]);
    deleteWhiteboardFreeLine(store, { projectId: project.id, id: first.id, expectedUpdatedAt: changed.updatedAt });
    expect(whiteboardFreeLines(store, project.id)).toEqual([]);
    store.close();
  });

  it('keeps project ownership and cascade deletion strict', () => {
    const { root, store, project } = fixture();
    const secondPath = join(root, 'other');
    mkdirSync(secondPath);
    const second = store.createProject({ name: 'Other', path: secondPath });
    const created = createWhiteboardFreeLine(store, { projectId: project.id, ...geometry });
    expect(whiteboardFreeLines(store, second.id)).toEqual([]);
    expect(() => updateWhiteboardFreeLine(store, { projectId: second.id, id: created.id, expectedUpdatedAt: created.updatedAt, label: 'cross-project' })).toThrow('not found');
    expect(() => deleteWhiteboardFreeLine(store, { projectId: second.id, id: created.id, expectedUpdatedAt: created.updatedAt })).toThrow('not found');
    expect(() => createWhiteboardFreeLine(store, { projectId: 'missing', ...geometry })).toThrow('Project not found');
    store.db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    expect(store.db.prepare('SELECT COUNT(*) AS count FROM whiteboard_free_lines').get()).toMatchObject({ count: 0 });
    store.close();
  });

  it('enforces the bounded project collection before insertion', () => {
    const { store, project } = fixture();
    const insert = store.db.prepare('INSERT INTO whiteboard_free_lines (id, project_id, x1, y1, x2, y2, line_style, end_marker, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const stamp = new Date().toISOString();
    store.db.transaction(() => {
      for (let index = 0; index < MAX_WHITEBOARD_FREE_LINES; index++)
        insert.run(`synthetic-${index}`, project.id, index, 0, index + 100, 0, 'solid', 'none', '', stamp, stamp);
    })();
    expect(whiteboardFreeLines(store, project.id)).toHaveLength(MAX_WHITEBOARD_FREE_LINES);
    expect(() => createWhiteboardFreeLine(store, { projectId: project.id, ...geometry })).toThrow(`At most ${MAX_WHITEBOARD_FREE_LINES}`);
    store.close();
  });
});
