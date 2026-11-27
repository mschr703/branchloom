import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { MAX_WHITEBOARD_EDGES, MAX_WHITEBOARD_NODES, createWhiteboardEdge, createWhiteboardNode, deleteWhiteboardEdge, deleteWhiteboardNode, updateWhiteboardNode, whiteboardSnapshot } from '../../src/main/whiteboard';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-'));
  roots.push(root);
  const file = join(root, 'store.sqlite');
  const store = new StudioStore(file);
  const folder = join(root, 'repo');
  mkdirSync(join(folder, 'src', 'renderer'), { recursive: true });
  const project = store.createProject({ name: 'Synthetic project', path: folder });
  const card = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Build a canvas' });
  return { root, file, store, project, card };
}

describe('project whiteboard', () => {
  it('adds the default shape to boxes saved before the shape palette', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-old-shape-'));
    roots.push(root);
    const file = join(root, 'legacy.sqlite');
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
      CREATE TABLE whiteboard_nodes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, description TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, reference_kind TEXT,
        card_id TEXT, folder_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    const stamp = '2026-01-01T00:00:00.000Z';
    legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run('project', 'Old project', root, stamp);
    legacy.prepare('INSERT INTO whiteboard_nodes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('old-box', 'project', 'Saved box', '', 0, 0, null, null, null, stamp, stamp);
    legacy.close();
    const store = new StudioStore(file);
    expect(whiteboardSnapshot(store, 'project').nodes[0]).toMatchObject({ id: 'old-box', shape: 'card' });
    expect(updateWhiteboardNode(store, { projectId: 'project', id: 'old-box', shape: 'decision' }).shape).toBe('decision');
    store.close();
  });

  it('persists visual node shapes, updates them, and rejects invalid values', () => {
    const { store, file, project } = fixture();
    const decision = createWhiteboardNode(store, { projectId: project.id, title: 'Choose route', x: 10, y: 20, shape: 'decision' });
    const ordinary = createWhiteboardNode(store, { projectId: project.id, title: 'Context', x: 30, y: 40 });
    expect(decision.shape).toBe('decision');
    expect(ordinary.shape).toBe('card');
    expect(() => createWhiteboardNode(store, { projectId: project.id, title: 'Invalid', x: 0, y: 0, shape: 'hexagon' as never })).toThrow('Form');
    expect(() => updateWhiteboardNode(store, { projectId: project.id, id: decision.id, shape: 'hexagon' as never })).toThrow('Form');
    expect(updateWhiteboardNode(store, { projectId: project.id, id: decision.id, shape: 'step' }).shape).toBe('step');
    store.close();
    const reopened = new StudioStore(file);
    expect(whiteboardSnapshot(reopened, project.id).nodes.map(({ shape }) => shape)).toEqual(['step', 'card']);
    reopened.close();
  });

  it('persists boxes, real folder links, card links and edges after restart', () => {
    const { store, file, project, card } = fixture();
    const folder = createWhiteboardNode(store, { projectId: project.id, title: 'Renderer', description: 'UI ownership', x: 13.1234, y: -20, reference: { kind: 'folder', path: 'src/renderer' } });
    const task = createWhiteboardNode(store, { projectId: project.id, title: 'Canvas card', x: 250, y: 10, reference: { kind: 'card', cardId: card.id } });
    const edge = createWhiteboardEdge(store, { projectId: project.id, sourceId: folder.id, targetId: task.id, label: 'contains' });
    expect(folder).toMatchObject({ x: 13.12, reference: { kind: 'folder', path: join('src', 'renderer') } });
    expect(whiteboardSnapshot(store, project.id).edges[0]).toEqual(edge);
    store.close();
    const reopened = new StudioStore(file);
    expect(whiteboardSnapshot(reopened, project.id).nodes).toHaveLength(2);
    expect(whiteboardSnapshot(reopened, project.id).edges[0]?.targetId).toBe(task.id);
    updateWhiteboardNode(reopened, { projectId: project.id, id: task.id, x: 300, title: 'Changed title' });
    expect(whiteboardSnapshot(reopened, project.id).nodes.find((item) => item.id === task.id)).toMatchObject({ x: 300, title: 'Changed title', reference: { kind: 'card', cardId: card.id } });
    deleteWhiteboardEdge(reopened, { projectId: project.id, id: edge.id });
    deleteWhiteboardNode(reopened, { projectId: project.id, id: folder.id });
    expect(whiteboardSnapshot(reopened, project.id)).toMatchObject({ nodes: [{ id: task.id }], edges: [] });
    reopened.close();
  });

  it('rejects cross-project card and edge references, duplicate connections, invalid positions and escaping folders', () => {
    const { store, project, card } = fixture();
    const secondRoot = mkdtempSync(join(tmpdir(), 'branchloom-whiteboard-other-'));
    roots.push(secondRoot);
    const second = store.createProject({ name: 'Other', path: secondRoot });
    const one = createWhiteboardNode(store, { projectId: project.id, title: 'One', x: 0, y: 0 });
    const two = createWhiteboardNode(store, { projectId: project.id, title: 'Two', x: 100, y: 0 });
    const other = createWhiteboardNode(store, { projectId: second.id, title: 'Other', x: 0, y: 0 });
    expect(() => createWhiteboardNode(store, { projectId: second.id, title: 'Invalid', x: 0, y: 0, reference: { kind: 'card', cardId: card.id } })).toThrow('Karte gehört nicht');
    expect(() => createWhiteboardNode(store, { projectId: project.id, title: 'Invalid', x: 0, y: 0, reference: { kind: 'folder', path: '..' } })).toThrow('außerhalb');
    expect(() => createWhiteboardNode(store, { projectId: project.id, title: 'Invalid', x: Number.NaN, y: 0 })).toThrow('Position');
    expect(() => createWhiteboardEdge(store, { projectId: project.id, sourceId: one.id, targetId: other.id })).toThrow('Projektgrenze');
    expect(() => createWhiteboardEdge(store, { projectId: project.id, sourceId: one.id, targetId: one.id })).toThrow('selbst');
    createWhiteboardEdge(store, { projectId: project.id, sourceId: one.id, targetId: two.id });
    expect(() => createWhiteboardEdge(store, { projectId: project.id, sourceId: one.id, targetId: two.id })).toThrow('existiert bereits');
    expect(whiteboardSnapshot(store, second.id).edges).toEqual([]);
    const ownEdge = whiteboardSnapshot(store, project.id).edges[0]!;
    expect(() => updateWhiteboardNode(store, { projectId: second.id, id: one.id, title: 'Tampered' })).toThrow('nicht zu diesem Projekt');
    expect(() => deleteWhiteboardNode(store, { projectId: second.id, id: one.id })).toThrow('nicht zu diesem Projekt');
    expect(() => deleteWhiteboardEdge(store, { projectId: second.id, id: ownEdge.id })).toThrow('nicht gefunden');
    expect(new Set(whiteboardSnapshot(store, project.id).nodes.map((item) => item.id))).toEqual(new Set([one.id, two.id]));
    expect(whiteboardSnapshot(store, project.id).edges).toMatchObject([{ id: ownEdge.id }]);
    store.close();
  });

  it('removes linked edges with a box and clears references to deleted cards', () => {
    const { store, project, card } = fixture();
    const one = createWhiteboardNode(store, { projectId: project.id, title: 'Card', x: 0, y: 0, reference: { kind: 'card', cardId: card.id } });
    const two = createWhiteboardNode(store, { projectId: project.id, title: 'Second', x: 100, y: 0 });
    createWhiteboardEdge(store, { projectId: project.id, sourceId: one.id, targetId: two.id });
    store.db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
    expect(whiteboardSnapshot(store, project.id).nodes.find((item) => item.id === one.id)?.reference).toBeNull();
    updateWhiteboardNode(store, { projectId: project.id, id: one.id, y: 40 });
    deleteWhiteboardNode(store, { projectId: project.id, id: one.id });
    expect(whiteboardSnapshot(store, project.id).edges).toEqual([]);
    store.close();
  });

  it('bounds large project graphs before creation or rendering', () => {
    const { store, project } = fixture();
    const stamp = new Date().toISOString();
    const insertNode = store.db.prepare('INSERT INTO whiteboard_nodes (id, project_id, title, description, x, y, reference_kind, card_id, folder_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)');
    store.db.transaction(() => {
      for (let index = 0; index < MAX_WHITEBOARD_NODES; index++) insertNode.run(`node-${index}`, project.id, `Box ${index}`, '', index, 0, stamp, stamp);
    })();
    expect(whiteboardSnapshot(store, project.id).nodes).toHaveLength(MAX_WHITEBOARD_NODES);
    expect(() => createWhiteboardNode(store, { projectId: project.id, title: 'One too many', x: 0, y: 0 })).toThrow('Maximal 500');
    const insertEdge = store.db.prepare('INSERT INTO whiteboard_edges (id, project_id, source_id, target_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    store.db.transaction(() => {
      for (let index = 0; index < MAX_WHITEBOARD_EDGES; index++) insertEdge.run(`edge-${index}`, project.id, `node-${index % 500}`, `node-${(index % 500 + Math.floor(index / 500) + 1) % 500}`, '', stamp);
    })();
    expect(whiteboardSnapshot(store, project.id).edges).toHaveLength(MAX_WHITEBOARD_EDGES);
    expect(() => createWhiteboardEdge(store, { projectId: project.id, sourceId: 'node-0', targetId: 'node-3' })).toThrow('Maximal 1000');
    store.db.prepare('DELETE FROM whiteboard_edges WHERE id = ?').run('edge-999');
    insertEdge.run('edge-extra-a', project.id, 'node-0', 'node-3', '', stamp);
    insertEdge.run('edge-extra-b', project.id, 'node-0', 'node-4', '', stamp);
    expect(() => whiteboardSnapshot(store, project.id)).toThrow('Anzeige-Limit');
    store.close();
  });
});
