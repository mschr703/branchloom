// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Column, TrelloImportPreview } from '../../src/shared/types';
import { TrelloImportPanel } from '../../src/renderer/components/TrelloImportPanel';

const columns: Column[] = [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }];
const preview: TrelloImportPreview = {
  fingerprint: 'synthetic-fingerprint', boardName: 'Synthetic Trello board', total: 1, eligible: 1, duplicates: 0,
  cards: [{ sourceId: 'source-a', title: 'Draft navigation', description: 'Explore the header', labels: [], labelNote: null,
    listId: 'source-list', listName: 'Inbox', archived: false, eligible: true, reason: null, importedCardId: null, importedIdeaId: null }],
};

describe('Trello Ideas import flow', () => {
  it('collects selected Trello cards as ideas by default and offers the Ideas room afterwards', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const previousApi = Object.getOwnPropertyDescriptor(window, 'studio');
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    const acceptTrelloBoardIdeas = vi.fn().mockResolvedValue({ created: [{ id: 'idea-a' }], skippedDuplicateIds: [] });
    const previewTrelloBoardIdeas = vi.fn().mockResolvedValueOnce(preview).mockResolvedValueOnce({ ...preview, duplicates: 1, cards: [{ ...preview.cards[0]!, importedIdeaId: 'idea-a' }] });
    const boardPreview = { ...preview, cards: [{ ...preview.cards[0]!, sourceId: 'source-b' }] };
    const previewTrelloBoard = vi.fn().mockResolvedValue(boardPreview);
    const acceptTrelloBoard = vi.fn().mockResolvedValue({ created: [{ id: 'card-b' }], skippedDuplicateIds: [] });
    const onIdeasImported = vi.fn().mockResolvedValue(undefined);
    const onBoardImported = vi.fn();
    const onClose = vi.fn();
    Object.defineProperty(window, 'studio', { configurable: true, value: {
      trelloConnectionStatus: vi.fn().mockResolvedValue({ connected: true, memberName: 'Sample user' }),
      trelloSignInAvailable: vi.fn().mockResolvedValue(true),
      trelloBoards: vi.fn().mockResolvedValue([{ id: 'board-a', name: 'Synthetic Trello board' }]),
      previewTrelloBoardIdeas, acceptTrelloBoardIdeas, previewTrelloBoard, acceptTrelloBoard,
    } });
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(<TrelloImportPanel projectId="p" columns={columns} mutate={async <T,>(action: () => Promise<T>) => action()} destination="ideas" onIdeasImported={onIdeasImported} onBoardImported={onBoardImported} onClose={onClose} />); });
      expect(host.textContent).toContain('Trello-Karten als Ideen sammeln');
      expect(host.querySelector<HTMLButtonElement>('.trello-destination button')?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Karten anzeigen'))!.click(); });
      expect(host.textContent).toContain('Optional: Ideen direkt einsortieren');
      expect(host.querySelector<HTMLSelectElement>('.trello-preview .trello-advanced select')?.value).toBe('idea');
      await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Ideen sammeln'))!.click(); });
      expect(acceptTrelloBoardIdeas).toHaveBeenCalledWith({ projectId: 'p', category: 'idea', boardId: 'board-a', fingerprint: 'synthetic-fingerprint', sourceIds: ['source-a'] });
      expect(onIdeasImported).toHaveBeenCalledOnce();
      expect(host.textContent).toContain('1 Ideen im Ideenraum gesammelt');
      expect(host.textContent).toContain('Bereits im Ideenraum');
      await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Ideenraum ansehen'))!.click(); });
      expect(onClose).toHaveBeenCalledOnce();
      await act(async () => { [...host.querySelectorAll('.trello-destination button')].find((button) => button.textContent?.includes('Board'))!.click(); });
      expect(host.textContent).toContain('Direkter Import legt sofort Board-Karten an');
      expect(host.querySelector('.trello-preview')).toBeNull();
      await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Karten anzeigen'))!.click(); });
      expect(previewTrelloBoard).toHaveBeenCalledWith({ projectId: 'p', boardId: 'board-a' });
      await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Karten importieren'))!.click(); });
      expect(acceptTrelloBoard).toHaveBeenCalledWith({ projectId: 'p', columnId: 'todo', boardId: 'board-a', fingerprint: 'synthetic-fingerprint', sourceIds: ['source-b'] });
      await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Board ansehen'))!.click(); });
      expect(onBoardImported).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { root.unmount(); });
      if (previousApi) Object.defineProperty(window, 'studio', previousApi); else Reflect.deleteProperty(window, 'studio');
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
      host.remove();
    }
  });
});
