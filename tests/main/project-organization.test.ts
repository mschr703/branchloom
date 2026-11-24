import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('project organization', () => {
  it('migrates existing projects and persists grouping and sort across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-project-organization-'));
    roots.push(root);
    const file = join(root, 'studio.sqlite');
    const legacy = new Database(file);
    legacy.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL)');
    legacy.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run('existing', 'Existing project', root, '2026-01-01T00:00:00Z');
    legacy.close();

    const store = new StudioStore(file);
    expect(store.projectOrganization()).toEqual({ groups: [], assignments: {}, sort: 'name' });
    expect(store.projects().map((project) => project.id)).toEqual(['existing']);
    const group = store.createProjectGroup('Client work').groups[0]!;
    store.assignProjectGroup({ projectId: 'existing', groupId: group.id });
    store.renameProjectGroup({ groupId: group.id, name: 'Active work' });
    store.setProjectSort('newest');
    store.close();

    const reopened = new StudioStore(file);
    expect(reopened.projectOrganization()).toEqual({ groups: [{ id: group.id, name: 'Active work' }], assignments: { existing: group.id }, sort: 'newest' });
    reopened.deleteProjectGroup(group.id);
    expect(reopened.projectOrganization().assignments).toEqual({});
    expect(reopened.project('existing').name).toBe('Existing project');
    reopened.close();
  });

  it('rejects invalid organization changes without changing saved assignments', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-project-organization-'));
    roots.push(root);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    const project = store.createProject({ name: 'Synthetic project', path: root });
    const group = store.createProjectGroup('Active').groups[0]!;
    store.assignProjectGroup({ projectId: project.id, groupId: group.id });
    expect(() => store.createProjectGroup('active')).toThrow();
    expect(() => store.renameProjectGroup({ groupId: 'missing', name: 'Nope' })).toThrow('Project group not found');
    expect(() => store.assignProjectGroup({ projectId: project.id, groupId: 'missing' })).toThrow('Project group not found');
    expect(() => store.assignProjectGroup({ projectId: 'missing', groupId: null })).toThrow('Project not found');
    expect(() => store.setProjectSort('random' as never)).toThrow('Invalid project sort');
    expect(store.projectOrganization().assignments[project.id]).toBe(group.id);
    store.close();
  });
});
