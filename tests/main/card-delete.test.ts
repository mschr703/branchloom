import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-delete-card-'));
  roots.push(root);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  const card = store.createCard({ projectId: project.id, columnId: column.id, title: 'Unused card' });
  return { store, dbPath, project, column, card };
}

describe('guarded card deletion', () => {
  it('removes an unused card and keeps that deletion after restart', () => {
    const { store, dbPath, project, card } = fixture();
    store.deleteCard(card.id);
    expect(store.snapshot(project.id).cards).toEqual([]);
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.snapshot(project.id).cards).toEqual([]);
    reopened.close();
  });

  it('preserves cards with a completed session or a workflow', () => {
    const { store, project, column, card } = fixture();
    const agent = store.agents()[0]!;
    const session = store.createSession({ cardId: card.id, agentId: agent.id });
    store.finishSession(session.id, 'exited', 0);
    expect(() => store.deleteCard(card.id)).toThrow('verknüpfte Daten');
    expect(store.card(card.id).title).toBe('Unused card');

    const planned = store.createCard({ projectId: project.id, columnId: column.id, title: 'Planned card' });
    store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [planned.id], steps: [{ id: 'step', columnId: column.id, agentId: null, requireApproval: false }] });
    expect(() => store.deleteCard(planned.id)).toThrow('Workflow');
    expect(store.card(planned.id).title).toBe('Planned card');
    store.close();
  });

  it('preserves cards with linked attachments and uses archive for their removal from the board', () => {
    const { store, card } = fixture();
    store.db.prepare('INSERT INTO card_attachments (id, card_id, path, name, size, added_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run('attachment', card.id, 'synthetic', 'example.txt', 1, '2026-11-27T00:00:00Z');
    expect(() => store.deleteCard(card.id)).toThrow('verknüpfte Daten');
    expect(store.setCardArchived({ id: card.id, archived: true }).archivedAt).toBeTruthy();
    store.close();
  });

  it('also protects a legacy command terminal link without a foreign key', () => {
    const { store, project, card } = fixture();
    store.db.prepare('INSERT INTO command_terminals (id, project_id, shell, state, started_at, ended_at, exit_code, output, card_id, worktree_path) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)')
      .run('terminal-a', project.id, 'cmd', 'stopped', '2026-11-27T00:00:00Z', '', card.id, 'synthetic');
    expect(() => store.deleteCard(card.id)).toThrow('verknüpfte Daten');
    expect(store.card(card.id).title).toBe('Unused card');
    store.close();
  });
});
