import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { QueuePreview } from '../../src/renderer/components/WorkflowView';
import type { Card } from '../../src/shared/types';

const card = (id: string, title: string): Card => ({ id, title, projectId: 'p', columnId: 'todo', description: '', priority: 'none', labels: [], position: 0, createdAt: '', updatedAt: '', archivedAt: null });

describe('queue preview', () => {
  it('shows the eligible card order and escapes titles', () => {
    const html = renderToStaticMarkup(createElement(QueuePreview, { cards: [card('a', 'First <task>'), card('b', 'Second task')], loading: false, error: null }));
    expect(html.indexOf('First &lt;task&gt;')).toBeLessThan(html.indexOf('Second task'));
    expect(html).toContain('<ol>');
    expect(html).toContain('Diese Vorschau startet nichts.');
  });

  it('distinguishes loading, an empty queue and a missing To-Do column', () => {
    expect(renderToStaticMarkup(createElement(QueuePreview, { cards: [], loading: true, error: null }))).toContain('Reihenfolge wird geladen');
    expect(renderToStaticMarkup(createElement(QueuePreview, { cards: [], loading: false, error: null }))).toContain('Keine freie To-Do-Karte');
    expect(renderToStaticMarkup(createElement(QueuePreview, { cards: [], loading: false, error: 'Für die Warteschlange fehlt eine To-Do-Spalte.' }))).toContain('fehlt eine To-Do-Spalte');
  });

  it('labels the opt-in preview as startable and explains pending dependencies', () => {
    const html = renderToStaticMarkup(createElement(QueuePreview, { cards: [], loading: false, error: null, skipBlocked: true }));
    expect(html).toContain('Nächste startbare To-Do-Karten');
    expect(html).toContain('Karten mit offenen Vorgängern bleiben im Board');
  });
});
