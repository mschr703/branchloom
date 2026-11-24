import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiContractPanel } from '../../src/renderer/components/ApiContractPanel';

describe('API contract panel', () => {
  it('offers a separate preview before a revision can be saved and explains the local check', () => {
    const html = renderToStaticMarkup(createElement(ApiContractPanel, { projectId: 'synthetic', cards: [] }));
    expect(html).toContain('aria-label="Gemeinsamer API-Vertrag"');
    expect(html).toContain('Vorschau prüfen');
    expect(html).not.toContain('Revision 1 speichern');
    expect(html).toContain('Karten gezielt zuordnen');
  });
});
