import { describe, expect, it } from 'vitest';
import type { Card, CardContextReference, Project, Session } from '../../src/shared/types';
import { projectKnowledgeMapPage } from '../../src/renderer/project-knowledge-map';
import { knowledgeMapFlow } from '../../src/renderer/components/ProjectKnowledgeMap';

const project: Project = { id: 'p', name: 'Project', path: 'synthetic', createdAt: '2026-01-01T00:00:00Z' };
function card(id: string, projectId = 'p'): Card {
  return { id, projectId, columnId: 'todo', title: id, description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null };
}
function session(id: string, cardId: string, state: Session['state'] = 'exited', output = 'Saved run', projectId = 'p'): Session {
  return { id, projectId, cardId, agentId: 'agent', state, output, startedAt: '2026-01-02T00:00:00Z', endedAt: '2026-01-02T01:00:00Z', exitCode: 0 };
}
function reference(id: string, cardId: string, target: string, projectId = 'p', kind: CardContextReference['kind'] = 'file', available = true): CardContextReference {
  return { id, cardId, projectId, kind, target, addedAt: `2026-01-0${Math.min(Number(id.replace(/\D/g, '')) || 1, 9)}T00:00:00Z`, available };
}

describe('project knowledge map', () => {
  it('connects only saved finished sessions to cards in the same project', () => {
    const map = projectKnowledgeMapPage({ project, cards: [card('a'), card('b'), card('foreign', 'other')], sessions: [
      session('real', 'a'), session('running', 'a', 'running'), session('blank', 'a', 'exited', '  '),
      session('orphan', 'missing'), session('foreign', 'b', 'exited', 'Saved run', 'other'),
    ] });
    expect(map.totalCards).toBe(2);
    expect(map.totalSessions).toBe(1);
    expect(map.groups[0]?.card.id).toBe('a');
    expect(map.groups[0]?.sessions.map((item) => item.id)).toEqual(['real']);
    expect(map.groups[1]?.sessions).toEqual([]);
  });

  it('pages a bounded, stable view and reports omitted runs without inventing links', () => {
    const cards = Array.from({ length: 8 }, (_, index) => card(`card-${index}`));
    const sessions = [session('one', 'card-0'), session('two', 'card-0'), session('three', 'card-0')];
    const first = projectKnowledgeMapPage({ project, cards, sessions });
    expect(first.groups).toHaveLength(4);
    expect(first.groups[0]?.sessions.map((item) => item.id)).toHaveLength(2);
    expect(first.hiddenSessions).toBe(1);
    expect(first.pages).toBe(2);
    expect(projectKnowledgeMapPage({ project, cards, sessions }, 1).groups).toHaveLength(4);
    expect(projectKnowledgeMapPage({ project, cards, sessions }, 99).page).toBe(1);
    expect(projectKnowledgeMapPage({ project, cards, sessions }, Number.NaN).page).toBe(0);
  });

  it('shows only explicitly saved file and folder references for visible project cards', () => {
    const refs = [reference('1', 'a', 'src/ui.tsx'), reference('2', 'b', 'src/ui.tsx'), reference('3', 'a', 'src'),
      reference('4', 'a', 'src/old.ts', 'p', 'file', false), reference('5', 'a', 'https://example.com', 'p', 'url'),
      reference('6', 'a', 'secret.ts', 'other'), reference('7', 'missing', 'orphan.ts')];
    const map = projectKnowledgeMapPage({ project, cards: [card('a'), card('b')], sessions: [] }, 0, refs);
    expect(map.totalReferences).toBe(4);
    expect(map.hiddenReferences).toBe(1);
    expect(map.groups.find((group) => group.card.id === 'a')?.references.map((item) => item.target)).toEqual(['src/old.ts', 'src',]);
    expect(map.groups.find((group) => group.card.id === 'b')?.references.map((item) => item.target)).toEqual(['src/ui.tsx']);
    expect(map.groups.flatMap((group) => group.references).some((item) => item.target === 'secret.ts' || item.target === 'orphan.ts')).toBe(false);
  });

  it('uses one source node for a file explicitly attached to two cards', () => {
    const snapshot = { project, cards: [card('a'), card('b')], sessions: [] };
    const map = projectKnowledgeMapPage(snapshot, 0, [reference('1', 'a', 'src/shared.ts'), reference('2', 'b', 'src/shared.ts')]);
    const flow = knowledgeMapFlow(map.groups, [], '');
    expect(flow.nodes.filter((node) => node.id === 'source:file:src/shared.ts')).toHaveLength(1);
    expect(flow.edges.filter((edge) => edge.target === 'source:file:src/shared.ts').map((edge) => edge.source).sort()).toEqual(['task:a', 'task:b']);
    const source = flow.nodes.find((node) => node.id === 'source:file:src/shared.ts')!;
    const tasks = flow.nodes.filter((node) => node.id.startsWith('task:'));
    expect(source.position.x).toBeGreaterThan(Math.min(...tasks.map((node) => node.position.x)));
    expect(source.position.x).toBeLessThan(Math.max(...tasks.map((node) => node.position.x)));
    expect(source.position.y).toBeGreaterThan(tasks[0]!.position.y);
  });

  it('keeps multiple saved file nodes from covering one another', () => {
    const snapshot = { project, cards: [card('a')], sessions: [] };
    const map = projectKnowledgeMapPage(snapshot, 0, [reference('1', 'a', 'src/one.ts'), reference('2', 'a', 'src/two.ts')]);
    const sources = knowledgeMapFlow(map.groups, [], '').nodes.filter((node) => node.id.startsWith('source:'));
    expect(sources).toHaveLength(2);
    expect(Math.abs(sources[0]!.position.x - sources[1]!.position.x)).toBeGreaterThanOrEqual(238);
  });
});
