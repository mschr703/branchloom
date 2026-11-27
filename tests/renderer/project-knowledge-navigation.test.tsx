// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSnapshot } from '../../src/shared/types';

vi.mock('@xyflow/react', () => ({
  Position: { Left: 'left', Right: 'right' },
  Background: () => null,
  Controls: () => null,
  ReactFlow: ({ nodes, onNodeClick, children }: { nodes: { id: string }[]; onNodeClick: (event: unknown, node: { id: string }) => void; children: ReactNode }) =>
    <div>{nodes.map((node) => <button key={node.id} type="button" data-node={node.id} onClick={(event) => onNodeClick(event, node)}>{node.id}</button>)}{children}</div>,
}));

import { ProjectKnowledgeMap } from '../../src/renderer/components/ProjectKnowledgeMap';

describe('project knowledge source navigation', () => {
  it('follows a saved run to its task and returns to the previous inspected source', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const oldApi = Object.getOwnPropertyDescriptor(window, 'studio');
    const oldAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'studio', { configurable: true, value: {
      cardContextReferences: vi.fn().mockResolvedValue([]),
      projectMemoryMapSources: vi.fn().mockResolvedValue({ gitRef: null, headCommit: null, codeFiles: [], totalCodeFiles: 0 }),
    } });
    const snapshot = { project: { id: 'p', name: 'Sample', path: 'sample', createdAt: '2026-01-01T00:00:00Z' },
      cards: [{ id: 'task', projectId: 'p', columnId: 'todo', title: 'Build the view', description: '', priority: 'none', labels: [], wireframeRequired: false, position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', archivedAt: null }],
      sessions: [{ id: 'run', projectId: 'p', cardId: 'task', agentId: 'agent', state: 'exited', output: 'Saved work', startedAt: '2026-01-02T00:00:00Z', endedAt: '2026-01-02T01:00:00Z', exitCode: 0 }],
      agents: [], columns: [], workflows: [], notes: [] } as ProjectSnapshot;
    try {
      await act(async () => { root.render(<ProjectKnowledgeMap snapshot={snapshot} />); });
      expect(host.querySelector('.knowledge-map-related')?.textContent).toContain('Gespeicherter Lauf dieser Aufgabe');
      await act(async () => { host.querySelector<HTMLButtonElement>('.knowledge-map-related button')!.click(); });
      expect(host.querySelector('.knowledge-map-inspector h3')?.textContent).toBe('Agentenlauf');
      expect(host.querySelector('.knowledge-map-related')?.textContent).toContain('Dieser Aufgabe zugeordnet');
      await act(async () => { host.querySelector<HTMLButtonElement>('.knowledge-map-back')!.click(); });
      expect(host.querySelector('.knowledge-map-inspector h3')?.textContent).toBe('Build the view');
      expect(host.querySelector('.knowledge-map-back')).toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      if (oldApi) Object.defineProperty(window, 'studio', oldApi); else Reflect.deleteProperty(window, 'studio');
      if (oldAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', oldAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });
});
