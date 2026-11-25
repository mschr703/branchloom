// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { createWhiteboardNode, whiteboardSnapshot } from '../../src/main/whiteboard';
import { ProjectChat } from '../../src/renderer/components/ProjectChat';
import { savePreparedChatCanvasNode } from '../../src/renderer/project-chat-canvas';
import type { ProjectChatReply } from '../../src/shared/project-chat';
import type { StudioAPI } from '../../src/shared/types';

it('saves an edited, source-backed chat canvas only after the visible click and reopens the persisted node', async () => {
  const rootPath = mkdtempSync(join(tmpdir(), 'branchloom-chat-click-'));
  const repoPath = join(rootPath, 'repo');
  mkdirSync(repoPath);
  const dbPath = join(rootPath, 'studio.sqlite');
  const store = new StudioStore(dbPath);
  const mount = document.createElement('div');
  document.body.append(mount);
  const reactRoot = createRoot(mount);
  const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    const project = store.createProject({ name: 'Synthetic review project', path: repoPath });
    const snapshot = store.snapshot(project.id);
    const card = store.createCard({ projectId: project.id, columnId: snapshot.columns[0]!.id,
      title: 'Queue boundary', description: 'Review the recorded queue boundary.' });
    const indexAt = '2026-11-25T07:01:00.000Z';
    const reply: ProjectChatReply = {
      answer: 'The queue boundary is recorded in the card.',
      sources: [{ kind: 'task', sourceId: card.id, title: card.title, snippet: card.description,
        updatedAt: card.updatedAt, gitRef: null, path: null, cardId: card.id, sessionId: null }],
      index: { projectId: project.id, state: 'ready', indexedAt: indexAt, gitRef: null,
        counts: { task: 1, conversation: 0, commit: 0, code: 0 }, codeFilesSeen: 0, codeFilesIndexed: 0, warning: null },
      suggestion: { kind: 'canvas', title: 'Initial outline', body: 'Review the queue.', steps: ['Inspect card'] },
    };
    const discussProject = vi.fn(async () => reply);
    Object.defineProperty(window, 'studio', { configurable: true, value: { discussProject } });
    const api = {
      whiteboard: async (projectId: string) => whiteboardSnapshot(store, projectId),
      createWhiteboardNode: async (input: Parameters<StudioAPI['createWhiteboardNode']>[0]) => createWhiteboardNode(store, input),
    };
    const saveCanvas = vi.fn(async (title: string, description: string) => {
      await savePreparedChatCanvasNode(api, project.id, title, description, () => true);
    });
    await act(async () => { reactRoot.render(<ProjectChat snapshot={store.snapshot(project.id)} onSaveCanvas={saveCanvas} />); });
    const question = mount.querySelector<HTMLTextAreaElement>('#project-chat-message')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(question, 'What is the queue boundary?');
      question.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { mount.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(discussProject).toHaveBeenCalledOnce();
    expect(whiteboardSnapshot(store, project.id).nodes).toHaveLength(0);
    const title = mount.querySelector<HTMLInputElement>('.project-chat-draft input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Edited outline');
      title.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveButton = [...mount.querySelectorAll('button')].find((button) => button.textContent?.includes('Im Whiteboard speichern'))!;
    expect(saveButton).toBeTruthy();
    expect(saveButton.disabled).toBe(false);
    await act(async () => { saveButton.click(); });
    expect(saveCanvas).toHaveBeenCalledOnce();
    expect(mount.textContent).toContain('Im Whiteboard gespeichert');
    const [node] = whiteboardSnapshot(store, project.id).nodes;
    expect(node).toMatchObject({ title: 'Edited outline', reference: null });
    expect(node!.description).toContain(`task:${card.id}`);
    expect(node!.description).toContain(indexAt);
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    store.close();
    const reopened = new StudioStore(dbPath);
    try { expect(whiteboardSnapshot(reopened, project.id).nodes).toMatchObject([{ id: node!.id, title: 'Edited outline' }]); }
    finally { reopened.close(); }
  } finally {
    try { await act(async () => { reactRoot.unmount(); }); }
    finally {
      if (previousApi) Object.defineProperty(window, 'studio', previousApi);
      else Reflect.deleteProperty(window, 'studio');
      if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment);
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      mount.remove();
      try { store.close(); } catch { /* Store was closed before the persistence check. */ }
      rmSync(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});
