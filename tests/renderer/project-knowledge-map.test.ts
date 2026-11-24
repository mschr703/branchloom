import { describe, expect, it } from 'vitest';
import type { Card, Project, Session } from '../../src/shared/types';
import { projectKnowledgeMapPage } from '../../src/renderer/project-knowledge-map';

const project: Project = { id: 'p', name: 'Project', path: 'synthetic', createdAt: '2026-01-01T00:00:00Z' };
function card(id: string, projectId = 'p'): Card {
  return { id, projectId, columnId: 'todo', title: id, description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null };
}
function session(id: string, cardId: string, state: Session['state'] = 'exited', output = 'Saved run', projectId = 'p'): Session {
  return { id, projectId, cardId, agentId: 'agent', state, output, startedAt: '2026-01-02T00:00:00Z', endedAt: '2026-01-02T01:00:00Z', exitCode: 0 };
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
});
