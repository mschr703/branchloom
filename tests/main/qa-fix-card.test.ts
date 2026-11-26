import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { createQaFixCard, previewQaFixCard } from '../../src/main/qa-fix-card';

const roots: string[] = [];
const stores: StudioStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) { try { store.close(); } catch { /* Closed in a restart test. */ } }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

function fixture(status: 'failed' | 'error' | 'passed' = 'failed') {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-qa-fix-'));
  roots.push(root);
  const repo = join(root, 'repo'); mkdirSync(repo);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file); stores.push(store);
  const project = store.createProject({ name: 'Synthetic QA', path: repo });
  const columns = store.snapshot(project.id).columns;
  const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Original QA task' });
  const reportId = 'synthetic-qa-report';
  store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, started_at, ended_at, status, diagnostics_json, page_check, page_observations_json, note, viewport_width, viewport_height)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(reportId, card.id, project.id, 'http://127.0.0.1:5173/settings',
    '2026-11-24T01:00:00.000Z', '2026-11-24T01:00:01.000Z', status,
    JSON.stringify([{ id: 'finding', kind: 'console', message: 'Synthetic console error', pageUrl: 'http://127.0.0.1:5173/settings', sourceUrl: null, line: null, capturedAt: '2026-11-24T01:00:01.000Z' }]),
    'complete', '[]', null, 390, 844);
  return { root, file, store, project, columns, card, reportId };
}

describe('explicit fix card from saved local QA', () => {
  it('previews a bounded editable draft and persists one source-linked card across restart', () => {
    const { store, file, project, columns, card, reportId } = fixture();
    const preview = previewQaFixCard(store, { projectId: project.id, sourceCardId: card.id, reportId });
    expect(preview.title).toContain('/settings');
    expect(preview.description).toContain('Synthetic console error');
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    const input = { projectId: project.id, sourceCardId: card.id, reportId, token: preview.token, columnId: columns[1]!.id,
      title: 'Fix settings', description: 'Reproduce with synthetic data' };
    const created = createQaFixCard(store, input);
    expect(created.title).toBe('Fix settings');
    expect(created.description).toContain('Reproduce with synthetic data');
    expect(created.description).toContain(`QA-Bericht ${reportId}`);
    expect(createQaFixCard(store, input).id).toBe(created.id);
    expect(store.snapshot(project.id).sessions).toHaveLength(0);
    store.close();
    const reopened = new StudioStore(file); stores.push(reopened);
    expect(createQaFixCard(reopened, input).id).toBe(created.id);
    expect(reopened.snapshot(project.id).cards).toHaveLength(2);
  });

  it('rejects foreign project/card/report and stale or non-failed source', () => {
    const { store, project, columns, card, reportId, root } = fixture();
    const preview = previewQaFixCard(store, { projectId: project.id, sourceCardId: card.id, reportId });
    const input = { projectId: project.id, sourceCardId: card.id, reportId, token: preview.token, columnId: columns[1]!.id,
      title: 'Fix', description: '' };
    const otherRepo = join(root, 'other'); mkdirSync(otherRepo);
    const other = store.createProject({ name: 'Other', path: otherRepo });
    expect(() => previewQaFixCard(store, { ...input, projectId: other.id })).toThrow('anderen Projekt');
    expect(() => createQaFixCard(store, { ...input, columnId: store.snapshot(other.id).columns[0]!.id })).toThrow('anderen Projekt');
    const second = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Second' });
    expect(() => previewQaFixCard(store, { ...input, sourceCardId: second.id })).toThrow('nicht mehr');
    store.db.prepare('UPDATE card_qa_reports SET note = ? WHERE id = ?').run('changed', reportId);
    expect(() => createQaFixCard(store, input)).toThrow('geändert');
    store.db.prepare('DELETE FROM card_qa_reports WHERE id = ?').run(reportId);
    expect(() => createQaFixCard(store, input)).toThrow('nicht mehr');
  });

  it('rejects passed reports and archived sources', () => {
    const passed = fixture('passed');
    expect(() => previewQaFixCard(passed.store, { projectId: passed.project.id, sourceCardId: passed.card.id, reportId: passed.reportId })).toThrow('Nur fehlgeschlagene');
    const failed = fixture();
    const draft = previewQaFixCard(failed.store, { projectId: failed.project.id, sourceCardId: failed.card.id, reportId: failed.reportId });
    failed.store.setCardArchived({ id: failed.card.id, archived: true });
    expect(() => previewQaFixCard(failed.store, { projectId: failed.project.id, sourceCardId: failed.card.id, reportId: failed.reportId })).toThrow('Archivierte');
    expect(() => createQaFixCard(failed.store, { projectId: failed.project.id, sourceCardId: failed.card.id, reportId: failed.reportId,
      token: draft.token, columnId: failed.columns[1]!.id, title: draft.title, description: draft.description })).toThrow('Archivierte');
  });

  it('blocks targets that might start an agent automatically', () => {
    const { store, project, columns, card, reportId } = fixture('error');
    store.updateColumn({ id: columns[1]!.id, agentId: store.agents()[0]!.id, autoStart: true });
    const preview = previewQaFixCard(store, { projectId: project.id, sourceCardId: card.id, reportId });
    const input = { projectId: project.id, sourceCardId: card.id, reportId, token: preview.token, title: preview.title, description: preview.description,
      columnId: columns[0]!.id };
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null });
    expect(() => createQaFixCard(store, input)).toThrow('Pausiere');
    expect(() => createQaFixCard(store, { ...input, columnId: columns[1]!.id })).toThrow('automatisch');
    expect(createQaFixCard(store, { ...input, columnId: columns[2]!.id }).columnId).toBe(columns[2]!.id);
  });
});
