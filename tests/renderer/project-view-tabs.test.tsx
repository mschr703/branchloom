// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdeasView } from '../../src/renderer/components/IdeasView';
import { ProjectViewTabs } from '../../src/renderer/components/ProjectViewTabs';
import { WorkflowView } from '../../src/renderer/components/WorkflowView';
import type { ProjectSnapshot } from '../../src/shared/types';

const snapshot: ProjectSnapshot = {
  project: { id: 'project', name: 'Synthetic project', path: 'C:\\synthetic', createdAt: '2026-01-01T00:00:00Z' },
  columns: [{ id: 'todo', projectId: 'project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
};

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('planning view navigation', () => {
  it('marks only the current view and keeps the others as native buttons', () => {
    const html = renderToStaticMarkup(createElement(ProjectViewTabs, { active: 'workflows', onNavigate: () => undefined }));
    expect(html).toContain('aria-label="Projektansichten"');
    expect(html).toContain('<span class="is-active" aria-current="page">Workflows</span>');
    expect(html).toContain('>Board</button>');
    expect(html).toContain('>Ideenraum</button>');
    const english = renderToStaticMarkup(createElement(ProjectViewTabs, { active: 'workflows', language: 'en', onNavigate: () => undefined }));
    expect(english).toContain('aria-label="Project views"');
    expect(english).toContain('>Ideas</button>');
  });

  it('keeps the project switcher visible above the workflow controls', () => {
    const html = renderToStaticMarkup(<WorkflowView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} onNavigate={() => undefined} />);
    expect(html).toContain('<span class="is-active" aria-current="page">Workflows</span>');
    expect(html.indexOf('aria-label="Projektansichten"')).toBeLessThan(html.indexOf('Route selbst erstellen'));
    expect(html).toContain('>Board</button>');
  });

  it('returns from ideas to the board and asks before discarding an edited note', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const navigate = vi.fn();
    const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    Object.defineProperty(window, 'studio', { configurable: true, value: { ideas: vi.fn().mockResolvedValue([]) } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(<IdeasView snapshot={snapshot} mutate={async <T,>(action: () => Promise<T>) => action()} onOpenCard={() => undefined} onNavigate={navigate} />); });
      const boardButton = [...host.querySelectorAll<HTMLButtonElement>('.project-view-tabs button')].find((button) => button.textContent === 'Board')!;
      expect(boardButton).toBeDefined();
      expect(host.querySelector('.project-view-tabs [aria-current="page"]')?.textContent).toBe('Ideenraum');
      await act(async () => { boardButton.click(); });
      expect(navigate).toHaveBeenCalledWith('board');

      navigate.mockClear();
      const note = host.querySelector<HTMLTextAreaElement>('.ideas-note-field textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Unsaved idea');
        note.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const confirm = vi.fn().mockReturnValue(false);
      vi.stubGlobal('confirm', confirm);
      await act(async () => { boardButton.click(); });
      expect(confirm).toHaveBeenCalledOnce();
      expect(navigate).not.toHaveBeenCalled();
      confirm.mockReturnValue(true);
      await act(async () => { boardButton.click(); });
      expect(navigate).toHaveBeenCalledWith('board');
    } finally {
      await act(async () => { root.unmount(); });
      if (previousApi) Object.defineProperty(window, 'studio', previousApi);
      else Reflect.deleteProperty(window, 'studio');
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    }
  });
});
