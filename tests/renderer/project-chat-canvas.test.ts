import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { StudioStore } from '../../src/main/store';
import { createWhiteboardNode, whiteboardSnapshot } from '../../src/main/whiteboard';
import { nextChatCanvasPosition, prepareChatCanvasNode, savePreparedChatCanvasNode } from '../../src/renderer/project-chat-canvas';
import type { ProjectChatReply, ProjectChatSuggestion } from '../../src/shared/project-chat';
import type { StudioAPI, WhiteboardNode, WhiteboardSnapshot } from '../../src/shared/types';

const suggestion: ProjectChatSuggestion = { kind: 'canvas', title: 'System map', body: 'Review the saved queue boundary.', steps: ['List inputs', 'Check approval'] };
function reply(projectId: string): ProjectChatReply {
  return {
    answer: 'The queue has a saved boundary.',
    suggestion,
    sources: [{ kind: 'task', sourceId: 'card\n1', title: 'Queue', snippet: 'Stored queue', updatedAt: '2026-11-25T07:00:00.000Z', gitRef: null, path: null, cardId: 'card-1', sessionId: null }],
    index: { projectId, state: 'ready', indexedAt: '2026-11-25T07:01:00.000Z', gitRef: null,
      counts: { task: 1, conversation: 0, commit: 0, code: 0 }, codeFilesSeen: 0, codeFilesIndexed: 0, warning: null },
  };
}

describe('explicit project-chat canvas handoff', () => {
  it('only persists a node after the user-triggered write and keeps it after reopening SQLite', () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-chat-canvas-'));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    const dbPath = join(root, 'studio.sqlite');
    const store = new StudioStore(dbPath);
    try {
      const project = store.createProject({ name: 'Synthetic', path: repo });
      const prepared = prepareChatCanvasNode(project.id, reply(project.id), suggestion);
      expect(prepared.description).toContain('Index 2026-11-25T07:01:00.000Z');
      expect(prepared.description).toContain('task:card\\n1');
      expect(whiteboardSnapshot(store, project.id).nodes).toEqual([]);
      const node = createWhiteboardNode(store, { projectId: project.id, ...prepared,
        ...nextChatCanvasPosition(whiteboardSnapshot(store, project.id).nodes) });
      expect(node).toMatchObject({ title: 'System map', x: 40, y: 40, reference: null });
      store.close();
      const reopened = new StudioStore(dbPath);
      try { expect(whiteboardSnapshot(reopened, project.id).nodes).toMatchObject([{ id: node.id, description: prepared.description }]); }
      finally { reopened.close(); }
    } finally {
      try { store.close(); } catch { /* Already closed after the persistence check. */ }
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects missing or foreign project evidence before a save can be offered', () => {
    expect(() => prepareChatCanvasNode('another-project', reply('project'), suggestion)).toThrow('keine gültigen Projektbelege');
    expect(() => prepareChatCanvasNode('project', { ...reply('project'), sources: [] }, suggestion)).toThrow('keine gültigen Projektbelege');
    expect(() => prepareChatCanvasNode('project', { ...reply('project'), index: { ...reply('project').index, indexedAt: null } }, suggestion)).toThrow('Indexstand');
    expect(() => prepareChatCanvasNode('project', reply('project'), { ...suggestion, kind: 'task' })).toThrow('keine gültigen Projektbelege');
  });

  it('rejects invalid title and excessive whiteboard content without truncating it', () => {
    expect(() => prepareChatCanvasNode('project', reply('project'), { ...suggestion, title: 'a'.repeat(121) })).toThrow('120 Zeichen');
    expect(() => prepareChatCanvasNode('project', reply('project'), { ...suggestion, body: 'x'.repeat(2000) })).toThrow('zu lang');
    expect(nextChatCanvasPosition([{ x: 40, y: 40 }, { x: 360, y: 40 }])).toEqual({ x: 680, y: 40 });
  });

  it('does not write when the active project changes while its whiteboard is loading', async () => {
    let finishRead!: (board: WhiteboardSnapshot) => void;
    let active = true;
    const api = {
      whiteboard: vi.fn(() => new Promise<WhiteboardSnapshot>((resolve) => { finishRead = resolve; })),
      createWhiteboardNode: vi.fn(async (_input: Parameters<StudioAPI['createWhiteboardNode']>[0]) => ({} as WhiteboardNode)),
    };
    const pending = savePreparedChatCanvasNode(api, 'old-project', 'Title', 'Description', () => active);
    active = false;
    finishRead({ nodes: [], edges: [] });
    await expect(pending).rejects.toThrow('Projekt wurde gewechselt');
    expect(api.createWhiteboardNode).not.toHaveBeenCalled();
  });
});
