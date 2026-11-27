import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Card, CardContextReference, Project, ProjectSnapshot, Session } from '../../src/shared/types';
import { knowledgeMapFileForHit, knowledgeMapPageForCard, projectKnowledgeMapPage, visibleKnowledgeCodeFiles } from '../../src/renderer/project-knowledge-map';
import { knowledgeMapFlow, ProjectKnowledgeMap } from '../../src/renderer/components/ProjectKnowledgeMap';
import type { ProjectMemoryMapSources } from '../../src/shared/project-memory-index';

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
  it('starts with a bounded local view while keeping the complete source list reachable', () => {
    const snapshot = { project, cards: [card('a'), card('b')], sessions: [session('run-a', 'a')], agents: [], columns: [], workflows: [], notes: [] } as ProjectSnapshot;
    const html = renderToStaticMarkup(createElement(ProjectKnowledgeMap, { snapshot }));
    expect(html).toContain('aria-label="Netzumfang"');
    expect(html).toContain('aria-pressed="true">Umgebung</button>');
    expect(html).toContain('aria-label="Verbindungstiefe"');
    expect(html).toContain('Quellen als Liste (3)');
    expect(html).toContain('2/3 Quellen im Ausschnitt');
  });

  it('shows all isolated sources when the current excerpt has no saved relationships', () => {
    const snapshot = { project, cards: [card('a'), card('b')], sessions: [], agents: [], columns: [], workflows: [], notes: [] } as ProjectSnapshot;
    const html = renderToStaticMarkup(createElement(ProjectKnowledgeMap, { snapshot }));
    expect(html).not.toContain('aria-label="Netzumfang"');
    expect(html).toContain('Quellen als Liste (2)');
    expect(html).toContain('Quelle auswählen');
  });

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

  it('locates a source-backed task across graph pages without inventing a new node', () => {
    const snapshot = { project, cards: Array.from({ length: 9 }, (_, index) => card(`card-${index}`)), sessions: [] };
    expect(knowledgeMapPageForCard(snapshot, 'card-8')).toBe(2);
    expect(knowledgeMapPageForCard(snapshot, 'missing')).toBeNull();
  });

  it('matches a code search hit to a graph file when the project path prefix is omitted', () => {
    const sources = { gitRef: 'abc', headCommit: null, totalCodeFiles: 1,
      codeFiles: [{ path: 'src/app.ts', sourceId: 'packages/ui/src/app.ts#1', updatedAt: '2026-01-01T00:00:00Z' }] } satisfies ProjectMemoryMapSources;
    expect(knowledgeMapFileForHit(sources, 'packages/ui/src/app.ts', 'packages/ui/src/app.ts#42')?.path).toBe('src/app.ts');
    expect(knowledgeMapFileForHit(sources, 'packages/ui/src/missing.ts', 'missing#1')).toBeNull();
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

  it('focuses only direct saved relationships for a selected source', () => {
    const snapshot = { project, cards: [card('a'), card('b'), card('c')], sessions: [session('run-a', 'a')] };
    const map = projectKnowledgeMapPage(snapshot, 0, [reference('1', 'a', 'src/shared.ts'), reference('2', 'b', 'src/shared.ts')]);
    const flow = knowledgeMapFlow(map.groups, [], 'source:file:src/shared.ts');
    expect(flow.nodes.filter((node) => node.className?.includes('in-focus')).map((node) => node.id).sort())
      .toEqual(['source:file:src/shared.ts', 'task:a', 'task:b']);
    expect(flow.nodes.find((node) => node.id === 'conversation:run-a')?.className).toContain('quiet');
    expect(flow.nodes.find((node) => node.id === 'task:c')?.className).toContain('quiet');
    expect(flow.edges.filter((edge) => edge.className?.includes('emphasized')).map((edge) => edge.source).sort())
      .toEqual(['task:a', 'task:b']);
    expect(flow.edges.find((edge) => edge.target === 'conversation:run-a')?.className).toContain('quiet');
    expect(knowledgeMapFlow(map.groups, [], 'missing').nodes.some((node) => node.className?.includes('quiet'))).toBe(false);
  });

  it('offers a compact network without changing the verified source graph', () => {
    const snapshot = { project, cards: [card('a'), card('b')], sessions: [session('run-a', 'a'), session('run-b', 'b')] };
    const map = projectKnowledgeMapPage(snapshot, 0, [reference('1', 'a', 'src/shared.ts'), reference('2', 'b', 'src/shared.ts')]);
    const structure = knowledgeMapFlow(map.groups, [], 'source:file:src/shared.ts');
    const network = knowledgeMapFlow(map.groups, [], 'source:file:src/shared.ts', null, 'all', '', 'network');
    expect(network.nodes.map((node) => node.id)).toEqual(structure.nodes.map((node) => node.id));
    expect(network.edges.map((edge) => [edge.source, edge.target, edge.className])).toEqual(
      structure.edges.map((edge) => [edge.source, edge.target, edge.className]));
    expect(network.nodes.every((node) => node.className?.includes('network'))).toBe(true);
    expect(network.nodes.find((node) => node.id === 'source:file:src/shared.ts')?.className).toContain('in-focus');
    expect(network.nodes.some((node, index) => node.position.x !== structure.nodes[index]!.position.x
      || node.position.y !== structure.nodes[index]!.position.y)).toBe(true);
  });

  it('keeps multiple saved file nodes from covering one another', () => {
    const snapshot = { project, cards: [card('a')], sessions: [] };
    const map = projectKnowledgeMapPage(snapshot, 0, [reference('1', 'a', 'src/one.ts'), reference('2', 'a', 'src/two.ts')]);
    const sources = knowledgeMapFlow(map.groups, [], '').nodes.filter((node) => node.id.startsWith('source:'));
    expect(sources).toHaveLength(2);
    expect(Math.abs(sources[0]!.position.x - sources[1]!.position.x)).toBeGreaterThanOrEqual(238);
  });

  it('connects only indexed files at the recorded Git ref, reusing an explicit card file node', () => {
    const map = projectKnowledgeMapPage({ project, cards: [card('a')], sessions: [session('run', 'a')] }, 0,
      [reference('1', 'a', 'src/relay.ts'), reference('2', 'a', 'src/missing.ts')]);
    const sources: ProjectMemoryMapSources = { gitRef: 'a'.repeat(40), headCommit: { sourceId: 'a'.repeat(40), title: 'Recorded head', updatedAt: '2026-01-02T00:00:00Z' },
      codeFiles: [{ path: 'src/relay.ts', sourceId: 'src/relay.ts#1', updatedAt: '2026-01-02T00:00:00Z' }], totalCodeFiles: 1 };
    const flow = knowledgeMapFlow(map.groups, [], '', sources);
    expect(flow.nodes.filter((node) => node.id === 'source:file:src/relay.ts')).toHaveLength(1);
    expect(flow.nodes.some((node) => node.id === 'commit:' + sources.gitRef)).toBe(true);
    expect(flow.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'task:a', target: 'conversation:run' }),
      expect.objectContaining({ source: 'task:a', target: 'source:file:src/relay.ts' }),
      expect.objectContaining({ source: 'commit:' + sources.gitRef, target: 'source:file:src/relay.ts' }),
    ]));
    expect(flow.edges.some((edge) => edge.source.startsWith('commit:') && edge.target === 'source:file:src/missing.ts')).toBe(false);
    expect(knowledgeMapFlow(map.groups, [], '', null).nodes.some((node) => node.id.startsWith('commit:'))).toBe(false);
  });

  it('filters a bounded Git source view by path and prefers explicitly attached files', () => {
    const sources: ProjectMemoryMapSources = { gitRef: 'b'.repeat(40), headCommit: { sourceId: 'b'.repeat(40), title: 'Head', updatedAt: '2026-01-02T00:00:00Z' },
      codeFiles: ['src/alpha.ts', 'src/beta.ts', 'src/ui.tsx'].map((path) => ({ path, sourceId: `${path}#1`, updatedAt: '2026-01-02T00:00:00Z' })), totalCodeFiles: 3 };
    const map = projectKnowledgeMapPage({ project, cards: [card('a')], sessions: [] }, 0, [reference('1', 'a', 'src/ui.tsx')]);
    expect(visibleKnowledgeCodeFiles(sources, map.groups.flatMap((group) => group.references), '', 2).map((file) => file.path)).toEqual(['src/ui.tsx', 'src/alpha.ts']);
    const flow = knowledgeMapFlow(map.groups, [], '', sources, 'code', 'beta');
    expect(flow.shownCodeFiles.map((file) => file.path)).toEqual(['src/beta.ts']);
    expect(flow.nodes.map((node) => node.id)).toEqual([`commit:${sources.gitRef}`, 'source:file:src/beta.ts']);
    expect(flow.edges).toHaveLength(1);
    expect(knowledgeMapFlow(map.groups, [], '', sources, 'work').nodes.some((node) => node.id.startsWith('commit:'))).toBe(false);
  });
});
