import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RequirementConflictsPanel, RequirementSuggestionList } from '../../src/renderer/components/RequirementConflictsPanel';

describe('requirement conflict UI', () => {
  it('shows the source-first classification form and does not promise semantic detection', () => {
    const html = renderToStaticMarkup(createElement(RequirementConflictsPanel, { projectId: 'synthetic', cards: [], onOpenCard: () => undefined }));
    expect(html).toContain('aria-label="Widersprüchliche Anforderungen"');
    expect(html).toContain('Originalaussage');
    expect(html).toContain('Bauteil');
    expect(html).toContain('Geltungsbereich');
    expect(html).toContain('genau diesem gemeinsamen Schlüssel');
  });
  it('keeps both verbatim sources, scope, reason and uncertainty visible before manual marking', () => {
    const source = { id: 'claim', projectId: 'project', cardId: 'first', cardTitle: 'First card', criterionId: 'one',
      statement: 'Navigation must be visible at widths up to 768 px.', cardRevision: 2, component: 'Navigation',
      scope: 'Width up to 768 px', property: 'Visibility', stance: 'required' as const, current: true, createdAt: '2026-11-25T00:00:00Z' };
    const html = renderToStaticMarkup(createElement(RequirementSuggestionList, { suggestions: [{ criterionId: 'two', cardId: 'second',
      cardTitle: 'Second card', statement: 'Navigation must not be visible at widths up to 768 px.', cardRevision: 3,
      proposedStance: 'forbidden', source }], limited: false, busy: false, onSelect: () => undefined, onOpenCard: () => undefined }));
    expect(html).toContain(source.statement);
    expect(html).toContain('Navigation must not be visible');
    expect(html).toContain('Vermuteter Bereich: Width up to 768 px');
    expect(html).toContain('Unsicher:');
    expect(html).toContain('Regelmarkierung prüfen');
    expect(html).not.toContain('Entscheidung speichern');
  });
});
