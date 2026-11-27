// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectChat } from '../../src/renderer/components/ProjectChat';
import type { ProjectChatReply } from '../../src/shared/project-chat';
import type { ProjectSnapshot } from '../../src/shared/types';

const snapshot = { project: { id: 'project-1', name: 'Synthetic workspace', path: '/synthetic', createdAt: '' },
  columns: [], cards: [], agents: [], sessions: [], workflows: [], notes: [], queue: { state: 'off' } } as ProjectSnapshot;

afterEach(() => { document.body.innerHTML = ''; });

it('keeps suggested questions editable and sends only after Ctrl+Enter while sources and draft remain visible', async () => {
  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const reply: ProjectChatReply = {
    answer: 'A decision is recorded in the task.',
    sources: [{ kind: 'task', sourceId: 'task-1', title: 'Review navigation', snippet: 'Confirm the navigation order.',
      updatedAt: '2026-11-27T10:00:00.000Z', gitRef: null, path: null, cardId: 'task-1', sessionId: null }],
    index: { projectId: 'project-1', state: 'ready', indexedAt: '2026-11-27T10:01:00.000Z', gitRef: null,
      counts: { task: 1, conversation: 0, commit: 0, code: 0 }, codeFilesSeen: 0, codeFilesIndexed: 0, warning: null },
    suggestion: { kind: 'task', title: 'Navigation decision', body: 'Confirm the order.', steps: [] },
  };
  const discussProject = vi.fn(async () => reply);
  const onSaveTask = vi.fn(async () => undefined);
  const onOpenCard = vi.fn();
  Object.defineProperty(window, 'studio', { configurable: true, value: { discussProject } });
  try {
    await act(async () => { root.render(<ProjectChat snapshot={snapshot} onSaveTask={onSaveTask} onOpenCard={onOpenCard} />); });
    const suggestion = [...mount.querySelectorAll('button')].find((button) => button.textContent === 'Offene Entscheidungen')!;
    await act(async () => { suggestion.click(); });
    const field = mount.querySelector<HTMLTextAreaElement>('#project-chat-message')!;
    expect(field.value).toContain('offenen Karten');
    expect(document.activeElement).toBe(field);
    expect(discussProject).not.toHaveBeenCalled();

    await act(async () => { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(discussProject).toHaveBeenCalledOnce();
    expect(mount.textContent).toContain('Review navigation');
    expect(mount.textContent).toContain('task:task-1');
    expect(mount.querySelector<HTMLInputElement>('.project-chat-draft input')?.value).toBe('Navigation decision');
    expect(onSaveTask).not.toHaveBeenCalled();
    const openSource = [...mount.querySelectorAll('button')].find((button) => button.textContent?.includes('Quelle öffnen'))!;
    await act(async () => { openSource.click(); });
    expect(onOpenCard).toHaveBeenCalledWith('task-1');
  } finally {
    await act(async () => { root.unmount(); });
    if (previousApi) Object.defineProperty(window, 'studio', previousApi);
    else Reflect.deleteProperty(window, 'studio');
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
    else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    mount.remove();
  }
});
