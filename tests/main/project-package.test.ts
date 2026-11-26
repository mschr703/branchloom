import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { cardCriteria, createCardCriterion } from '../../src/main/card-acceptance';
import { parseProjectPackage, PROJECT_PACKAGE_LIMIT } from '../../src/main/project-package';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jarvis-studio-package-'));
  const source = mkdtempSync(join(tmpdir(), 'jarvis-studio-package-source-'));
  const target = mkdtempSync(join(tmpdir(), 'jarvis-studio-package-target-'));
  roots.push(root, source, target);
  const dbPath = join(root, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const project = store.createProject({ name: 'Synthetic', path: source });
  return { store, dbPath, project, target };
}

describe('project package', () => {
  it('round-trips board, notes and workflow structure as a new, inert project', () => {
    const { store, dbPath, project, target } = fixture();
    const columns = store.snapshot(project.id).columns;
    const codex = store.agents().find((item) => item.kind === 'codex')!;
    store.updateColumn({ id: columns[1]!.id, autoStart: true, agentId: codex.id, model: 'gpt-6.1', effort: 'high', tint: 'lilac' });
    const card = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Synthetic task', description: 'Keep details', priority: 'urgent', labels: ['release'] });
    createCardCriterion(store, { cardId: card.id, text: 'Keyboard path works' });
    createCardCriterion(store, { cardId: card.id, text: 'Error state is visible' });
    const privateFile = join(project.path, 'private-attachment-sentinel.txt');
    writeFileSync(privateFile, 'private fixture content');
    store.addCardAttachments(card.id, [privateFile]);
    const second = store.createCard({ projectId: project.id, columnId: columns[0]!.id, title: 'Archive me' });
    store.setCardArchived({ id: second.id, archived: true });
    store.saveNote({ projectId: project.id, title: 'Decision', body: 'Keep this note', tags: ['design'], links: ['Later'] });
    store.createWorkflow({ projectId: project.id, name: 'Route', cardIds: [card.id], steps: [{ id: 'step', columnId: columns[1]!.id, agentId: codex.id, requireApproval: false }] });
    const original = store.snapshot(project.id);
    const json = JSON.stringify(store.exportProjectPackage(project.id));
    const parsed = parseProjectPackage(json);
    expect(parsed.version).toBe(2);
    expect(parsed).toMatchObject({ name: 'Synthetic', columns: expect.any(Array), cards: expect.any(Array), notes: expect.any(Array), workflows: expect.any(Array) });
    expect(parsed.cards.find((item) => item.id === card.id)?.criteria).toEqual(['Keyboard path works', 'Error state is visible']);
    expect(json).not.toContain(sourcePath(original.project.path));
    expect(json).not.toContain('private-attachment-sentinel');
    expect(json).not.toContain('private fixture content');
    expect(json).not.toContain('gpt-6.1');
    const imported = store.importProjectPackage({ name: 'Imported', path: target, json });
    expect(imported.id).not.toBe(project.id);
    const restored = store.snapshot(imported.id);
    expect(restored.columns).toHaveLength(columns.length);
    expect(restored.columns.every((item) => !item.autoStart && item.agentId === null && item.model === null && item.effort === null)).toBe(true);
    expect(restored.columns.find((item) => item.name === columns[1]!.name)?.tint).toBe('lilac');
    expect(restored.cards.map((item) => [item.title, item.description, item.priority, item.labels, Boolean(item.archivedAt)])).toEqual(original.cards.map((item) => [item.title, item.description, item.priority, item.labels, Boolean(item.archivedAt)]));
    expect(restored.cards.every((item) => item.projectId === imported.id && !original.cards.some((old) => old.id === item.id))).toBe(true);
    expect(cardCriteria(store, restored.cards.find((item) => item.title === card.title)!.id).map((item) => [item.text, item.evidence.length]))
      .toEqual([['Keyboard path works', 0], ['Error state is visible', 0]]);
    expect(restored.notes.map((item) => [item.title, item.body, item.tags, item.links])).toEqual(original.notes.map((item) => [item.title, item.body, item.tags, item.links]));
    expect(restored.workflows).toHaveLength(1);
    expect(restored.workflows[0]).toMatchObject({ name: 'Route', state: 'draft', currentStep: 0 });
    expect(restored.workflows[0]?.steps[0]).toMatchObject({ agentId: null, requireApproval: true });
    expect(restored.workflows[0]?.cardIds).toEqual([restored.cards.find((item) => item.title === card.title)?.id]);
    expect(restored.queue.state).toBe('off');
    expect(restored.sessions).toEqual([]);
    store.close();
    const reopened = new StudioStore(dbPath);
    expect(reopened.snapshot(imported.id).cards).toHaveLength(2);
    expect(cardCriteria(reopened, restored.cards.find((item) => item.title === card.title)!.id).map((item) => item.text))
      .toEqual(['Keyboard path works', 'Error state is visible']);
    expect(reopened.snapshot(project.id).cards).toHaveLength(2);
    reopened.close();
  });

  it('rejects a duplicate destination without modifying the existing project', () => {
    const { store, project } = fixture();
    const json = JSON.stringify(store.exportProjectPackage(project.id));
    expect(() => store.importProjectPackage({ name: 'Duplicate', path: project.path, json })).toThrow();
    expect(store.projects()).toHaveLength(1);
    expect(store.snapshot(project.id).columns).toHaveLength(6);
    store.close();
  });

  it('rejects malformed references, duplicate IDs and excessive package size before writes', () => {
    const { store, project, target } = fixture();
    store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Valid card' });
    const baseline = store.exportProjectPackage(project.id);
    expect(() => parseProjectPackage('{')).toThrow('JSON');
    expect(() => parseProjectPackage(JSON.stringify({ ...baseline, version: 3 }))).toThrow('Version');
    expect(() => parseProjectPackage(JSON.stringify({ ...baseline, columns: [...baseline.columns, baseline.columns[0]] }))).toThrow('doppelte');
    expect(() => parseProjectPackage(JSON.stringify({ ...baseline, columns: [{ ...baseline.columns[0], tint: 'neon' }, ...baseline.columns.slice(1)] }))).toThrow('Spaltenfarbe');
    expect(() => parseProjectPackage(JSON.stringify({ ...baseline, cards: [{ id: 'x', columnId: 'missing', title: 'Bad', description: '', priority: 'none', labels: [], position: 0, archived: false }] }))).toThrow('fehlende Spalte');
    const { criteria: _criteria, ...oldCard } = baseline.cards[0]!;
    expect(parseProjectPackage(JSON.stringify({ ...baseline, version: 1, cards: [oldCard] })).cards[0]?.criteria).toEqual([]);
    expect(() => parseProjectPackage(JSON.stringify({ ...baseline, cards: [oldCard] }))).toThrow('Abnahmekriterien');
    const badCriteriaCard = { ...baseline.cards[0]!, criteria: ['Valid', ''] };
    expect(() => store.importProjectPackage({ name: 'Bad criteria', path: target, json: JSON.stringify({ ...baseline, cards: [badCriteriaCard] }) })).toThrow('Abnahmekriterium');
    expect(() => parseProjectPackage(JSON.stringify({ ...baseline, cards: [{ ...baseline.cards[0]!, criteria: Array(31).fill('Too many') }] }))).toThrow('Abnahmekriterien');
    expect(() => parseProjectPackage(' '.repeat(PROJECT_PACKAGE_LIMIT + 1))).toThrow('8 MiB');
    expect(() => store.importProjectPackage({ name: 'Bad', path: target, json: JSON.stringify({ ...baseline, notes: [{ title: 'x', body: 'x', tags: [42], links: [] }] }) })).toThrow('Tag');
    expect(store.projects()).toHaveLength(1);
    store.close();
  });
});

function sourcePath(value: string): string { return value.replaceAll('\\', '\\\\'); }
