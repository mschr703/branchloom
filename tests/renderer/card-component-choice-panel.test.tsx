import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardComponentChoicePanel } from '../../src/renderer/components/CardComponentChoicePanel';

describe('card component references', () => {
  it('keeps source search optional and states the real local-app prerequisite for variants', () => {
    const html = renderToStaticMarkup(createElement(CardComponentChoicePanel, { cardId: 'card', projectId: 'project', archived: false }));
    expect(html).toContain('Komponentenreferenzen');
    expect(html).toContain('Quellen suchen');
    expect(html).toContain('Projektcode wird für diese Auswahl nicht ausgeführt');
    expect(html).toContain('laufende Projekt-App eine lokale Beispielroute');
    expect(html).not.toContain('gerenderte Komponentenbibliothek');
  });
});
