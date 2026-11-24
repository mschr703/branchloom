import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdeasView, ideaFromDrop, noteExcerpt, titleFromNote } from '../../src/renderer/components/IdeasView';
import type { Idea } from '../../src/shared/ideas';
import { IdeaMatchPanel } from '../../src/renderer/components/IdeaMatchPanel';
import type { ProjectSnapshot } from '../../src/shared/types';

const snapshot = {
  project: { id: 'synthetic-project', name: 'Synthetic project', path: 'synthetic-path', createdAt: '' },
  columns: [{ id: 'todo', projectId: 'synthetic-project', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
  cards: [], agents: [], sessions: [], workflows: [], notes: [],
  queue: { projectId: 'synthetic-project', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
} satisfies ProjectSnapshot;

describe('ideas room surface', () => {
  it('starts with one note field and keeps model transfer explicit', () => {
    const html = renderToStaticMarkup(createElement(IdeasView, { snapshot, mutate: async () => null, onOpenCard: () => undefined }));
    expect(html).toContain('Ideenraum');
    expect(html).toContain('Notiz festhalten');
    expect(html).toContain('Kurztitel optional');
    expect(html).toContain('Bereich der Notiz');
    expect(html).toContain('Zieh eine Notiz hierher');
    expect(html).toContain('Projekt-README (maximal 12 KB)');
    expect(html).toContain('Antworten ändern nichts automatisch');
    expect(html).not.toContain('Karte anlegen');
    expect(html).not.toContain('input required');
    expect(html).toContain('disabled');
    expect(html).toContain('Roadmap');
  });

  it('derives a useful title from the first non-empty line and does not duplicate it on the note', () => {
    expect(titleFromNote(' \n  Navigation auf kleinen Bildschirmen\n Menü reagiert spät')).toBe('Navigation auf kleinen Bildschirmen');
    expect(titleFromNote('   ')).toBe('');
    expect(titleFromNote('x'.repeat(180))).toHaveLength(100);
    expect(noteExcerpt({ title: 'Navigation auf kleinen Bildschirmen', body: 'Navigation auf kleinen Bildschirmen\nMenü reagiert spät' })).toBe('Menü reagiert spät');
    expect(noteExcerpt({ title: 'Eigener Titel', body: 'Navigation auf kleinen Bildschirmen' })).toBe('Navigation auf kleinen Bildschirmen');
  });

  it('accepts a dragged note only from the currently selected project', () => {
    const item: Idea = { id: 'a', projectId: 'synthetic-project', title: 'Note', body: 'Body', category: 'idea', turns: [], cardId: null,
      mergedIntoIdeaId: null, createdAt: '', updatedAt: '' };
    expect(ideaFromDrop([item], 'synthetic-project', 'a')).toBe(item);
    expect(ideaFromDrop([item], 'other-project', 'a')).toBeNull();
    expect(ideaFromDrop([item], 'synthetic-project', 'missing')).toBeNull();
  });

  it('discloses the local comparison and requires a saved idea before checking', () => {
    const html = renderToStaticMarkup(createElement(IdeaMatchPanel, { projectId: 'synthetic-project', ideaId: 'saved-idea', dirty: false,
      onOpenIdea: () => undefined, onOpenCard: () => undefined, onLinksChanged: async () => undefined }));
    expect(html).toContain('Ähnliche Einträge');
    expect(html).toContain('Vorschläge prüfen');
    expect(html).toContain('keine Daten an ein Modell gesendet');
  });
});
