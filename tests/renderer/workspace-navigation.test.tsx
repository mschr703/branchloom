import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceNavigation, views } from '../../src/renderer/components/WorkspaceNavigation';

describe('compact workspace navigation', () => {
  it('keeps every view reachable by its full name with one current destination', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNavigation, { activeView: 'memory', decisionCount: 0, onView: () => undefined }));
    expect((html.match(/<button /g) ?? [])).toHaveLength(views.length);
    expect((html.match(/aria-current="page"/g) ?? [])).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*aria-current="page"[^>]*aria-label="Memory"/);
    for (const view of views) expect(html).toContain(`aria-label="${view.name}"`);
    expect(html).toContain('aria-label="Planung"');
    expect(html).toContain('aria-label="Weitere Ansichten"');
  });

  it('announces an open decision count without changing the destination name', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNavigation, { activeView: 'board', decisionCount: 3, onView: () => undefined }));
    expect(html).toContain('aria-label="Entscheidungen: 3 offen"');
    expect(html).toContain('class="nav-count" aria-hidden="true">3</span>');
  });
});
