import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Column, TrelloImportCard, TrelloImportPreview } from '../../src/shared/types';
import { defaultTrelloSelection, importable, suggestedTrelloListColumns, trelloCardStatus, TrelloCardRow, TrelloImportPanel } from '../../src/renderer/components/TrelloImportPanel';

function card(sourceId: string, overrides: Partial<TrelloImportCard> = {}): TrelloImportCard {
  return { sourceId, title: `Testkarte ${sourceId}`, description: '', labels: [], labelNote: null, listId: 'aaaaaaaaaaaaaaaaaaaaaaaa', listName: 'Ideen', archived: false, eligible: true, reason: null, importedCardId: null, importedIdeaId: null, ...overrides };
}

const preview: TrelloImportPreview = {
  fingerprint: 'synthetic-fingerprint', boardName: 'Testboard', total: 4, eligible: 2, duplicates: 1,
  cards: [card('active'), card('archived', { archived: true }), card('duplicate', { importedCardId: 'existing' }), card('invalid', { eligible: false, reason: 'Ungültiger Titel' })],
};

describe('Trello import UI', () => {
  it('preselects only valid, new, active cards and allows archived cards explicitly', () => {
    expect(defaultTrelloSelection(preview)).toEqual(['active']);
    expect(importable(preview.cards[1])).toBe(true);
    expect(importable(preview.cards[2])).toBe(false);
    expect(importable(preview.cards[3])).toBe(false);
  });

  it('shows duplicate, invalid and archived reasons separately', () => {
    expect(trelloCardStatus(preview.cards[0])).toBe('Bereit');
    expect(trelloCardStatus(preview.cards[1])).toBe('Archiviert');
    expect(trelloCardStatus(preview.cards[2])).toBe('Bereits importiert');
    expect(trelloCardStatus(preview.cards[3])).toBe('Fehler: Ungültiger Titel');
    const staged = card('staged', { importedIdeaId: 'existing-idea' });
    expect(importable(staged)).toBe(false);
    expect(trelloCardStatus(staged)).toBe('Bereits im Ideenraum');
    expect(trelloCardStatus(card('changed', { importedIdeaId: 'existing-idea', sourceChange: 'changed' }))).toBe('Trello-Quelle geändert');
    expect(defaultTrelloSelection({ ...preview, cards: [staged] })).toEqual([]);
  });

  it('shows connection first, keeps JSON as an explicit fallback and imports nothing before preview', () => {
    const columns: Column[] = [{ id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }];
    const html = renderToStaticMarkup(createElement(TrelloImportPanel, { projectId: 'p', columns, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined }));
    expect(html).toContain('Karten aus Trello');
    expect(html).toContain('Trello verbinden');
    expect(html).toContain('JSON-Datei');
    expect(html).toContain('Mit Trello anmelden');
    expect(html).toContain('Eigener API-Key (erweitert)');
    expect(html.indexOf('Mit Trello anmelden')).toBeLessThan(html.indexOf('Eigener API-Key (erweitert)'));
    expect(html).toContain('Trello-API-Key');
    expect(html).toContain('Lesefreigabe im Browser öffnen');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Karten importieren');
    expect(html).not.toContain('type="file"');
    expect(html).toContain('nur nach deinem Klick');
    const ideasHtml = renderToStaticMarkup(createElement(TrelloImportPanel, { projectId: 'p', columns, mutate: async <T,>(action: () => Promise<T>) => action(), onClose: () => undefined, destination: 'ideas' }));
    expect(ideasHtml).toContain('Trello-Ideen vormerken');
    expect(ideasHtml).not.toContain('Zielspalte');
    expect(ideasHtml).not.toContain('trello-preview');
  });

  it('shows imported names and omitted color-only labels in the preview row', () => {
    const row = card('with-labels', { labels: ['Planung', 'Bug'], labelNote: '1 Trello-Label ohne auslesbaren Namen wird ausgelassen.' });
    const html = renderToStaticMarkup(createElement(TrelloCardRow, { card: row, checked: true, disabled: false, onToggle: () => undefined }));
    expect(html).toContain('Labels: Planung, Bug');
    expect(html).toContain('wird ausgelassen');
    expect(html).toContain('checked=""');
  });

  it('suggests name-matched target columns and a visible fallback for other Trello lists', () => {
    const columns: Column[] = [
      { id: 'todo', projectId: 'p', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null },
      { id: 'ideas', projectId: 'p', name: 'Ideen', position: 1, autoStart: false, agentId: null, model: null, effort: null },
    ];
    expect(suggestedTrelloListColumns({ ...preview, cards: [card('one'), card('two', { listId: 'bbbbbbbbbbbbbbbbbbbbbbbb', listName: 'Anderes' })] }, columns, 'todo'))
      .toEqual({ aaaaaaaaaaaaaaaaaaaaaaaa: 'ideas', bbbbbbbbbbbbbbbbbbbbbbbb: 'todo' });
  });
});
