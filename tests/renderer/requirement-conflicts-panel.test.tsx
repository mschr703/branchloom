import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RequirementConflictsPanel } from '../../src/renderer/components/RequirementConflictsPanel';

describe('requirement conflict UI', () => {
  it('shows the source-first classification form and does not promise semantic detection', () => {
    const html = renderToStaticMarkup(createElement(RequirementConflictsPanel, { projectId: 'synthetic', cards: [], onOpenCard: () => undefined }));
    expect(html).toContain('aria-label="Widersprüchliche Anforderungen"');
    expect(html).toContain('Originalaussage');
    expect(html).toContain('Bauteil');
    expect(html).toContain('Geltungsbereich');
    expect(html).toContain('genau diesem gemeinsamen Schlüssel');
  });
});
