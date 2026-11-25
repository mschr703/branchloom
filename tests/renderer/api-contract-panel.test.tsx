import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApiContractPanel } from '../../src/renderer/components/ApiContractPanel';
import { ApiContractHttpPanel } from '../../src/renderer/components/ApiContractHttpPanel';
import type { ApiContractVersion } from '../../src/shared/api-contract';

describe('API contract panel', () => {
  it('offers a separate preview before a revision can be saved and explains the local check', () => {
    const html = renderToStaticMarkup(createElement(ApiContractPanel, { projectId: 'synthetic', cards: [] }));
    expect(html).toContain('aria-label="Gemeinsamer API-Vertrag"');
    expect(html).toContain('Vorschau prüfen');
    expect(html).not.toContain('Revision 1 speichern');
    expect(html).toContain('Karten gezielt zuordnen');
  });
  it('offers explicit local mock and endpoint actions for a saved revision', () => {
    const contract: ApiContractVersion = { projectId: 'synthetic', revision: 1, createdAt: '2026-01-01T00:00:00Z', fingerprint: 'a'.repeat(64), expectedLatestRevision: 0,
      draft: { method: 'GET', path: '/api/items', response: 'array', fields: [{ name: 'id', type: 'string', required: true }], error: { status: 404, code: 'NOT_FOUND', message: 'Missing' } },
      example: [{ id: 'example_id' }], errorExample: { error: { code: 'NOT_FOUND', message: 'Missing' } } };
    const html = renderToStaticMarkup(createElement(ApiContractHttpPanel, { projectId: 'synthetic', contract }));
    expect(html).toContain('Mock starten');
    expect(html).toContain('Endpoint jetzt prüfen');
    expect(html).toContain('http://127.0.0.1:3000');
    expect(html).toContain('Antwortinhalte werden nicht gespeichert');
  });
});
