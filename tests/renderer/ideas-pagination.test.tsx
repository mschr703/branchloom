// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { IdeasView } from '../../src/renderer/components/IdeasView';
import type { Idea } from '../../src/shared/ideas';
import type { ProjectSnapshot } from '../../src/shared/types';

const snapshot = {
  project: { id: 'synthetic-project', name: 'Synthetic project', path: 'C:\\synthetic', createdAt: '' },
  columns: [{ id: 'todo', projectId: 'synthetic-project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'synthetic-project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
} satisfies ProjectSnapshot;

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('keeps a large imported ideas list searchable and bounded to one page', async () => {
  const ideas: Idea[] = Array.from({ length: 55 }, (_, index) => ({
    id: `note-${index}`, projectId: snapshot.project.id, title: index === 50 ? 'Trello deadline' : `Note ${index}`,
    body: index === 50 ? 'Imported source needs a reply.' : `Body ${index}`,
    category: 'idea', turns: [], cardId: null, mergedIntoIdeaId: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }));
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  Object.defineProperty(window, 'studio', { configurable: true, value: { ideas: vi.fn().mockResolvedValue(ideas) } });
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<IdeasView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} onOpenCard={() => undefined} />); });
    expect(host.querySelectorAll('.ideas-note')).toHaveLength(24);
    expect(host.textContent).toContain('Seite 1 von 3');
    const next = [...host.querySelectorAll<HTMLButtonElement>('.ideas-pagination button')].find((button) => button.textContent === 'Weiter')!;
    await act(async () => { next.click(); });
    expect(host.textContent).toContain('Seite 2 von 3');
    expect(host.querySelector('.ideas-note-grid')?.textContent).toContain('Note 24');

    const search = host.querySelector<HTMLInputElement>('input[aria-label="Notizen suchen"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Trello');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.querySelectorAll('.ideas-note')).toHaveLength(1);
    expect(host.querySelector('.ideas-note-grid')?.textContent).toContain('Trello deadline');
    expect(host.querySelector('.ideas-pagination')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
  }
});
