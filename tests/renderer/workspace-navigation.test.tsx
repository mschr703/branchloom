import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '../../src/shared/types';
import { projectNavigationStatus, WorkspaceNavigation, views } from '../../src/renderer/components/WorkspaceNavigation';

describe('compact workspace navigation', () => {
  it('keeps every view reachable by its full name with one current destination', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNavigation, { activeView: 'memory', decisionCount: 0, onView: () => undefined }));
    expect((html.match(/<button /g) ?? [])).toHaveLength(views.length);
    expect((html.match(/aria-current="page"/g) ?? [])).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*aria-current="page"[^>]*aria-label="Memory"/);
    for (const view of views) expect(html).toContain(`aria-label="${view.name}"`);
    expect(html).toContain('aria-label="Changelog"');
    expect(html).toContain('aria-label="Planung"');
    expect(html).toContain('aria-label="Weitere Ansichten"');
    expect(html).toContain('aria-label="Entwurf &amp; Wissen"');
    expect(html).toContain('aria-label="Prüfung"');
    expect(html).toContain('aria-label="Werkzeuge"');
  });

  it('announces an open decision count without changing the destination name', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNavigation, { activeView: 'board', decisionCount: 3, onView: () => undefined }));
    expect(html).toContain('aria-label="Entscheidungen: 3 offen"');
    expect(html).toContain('class="nav-count" aria-hidden="true">3</span>');
  });

  it('uses only the current project snapshot for real sidebar counts', () => {
    const snapshot = { project: { id: 'p' }, cards: [{ archivedAt: null }, { archivedAt: '2026-01-01' }], sessions: [{ state: 'running' }, { state: 'stopped' }] } as ProjectSnapshot;
    expect(projectNavigationStatus(snapshot, 'other')).toBeNull();
    expect(projectNavigationStatus(null, 'p')).toBeNull();
    const status = projectNavigationStatus(snapshot, 'p');
    expect(status).toEqual({ activeCards: 1, runningSessions: 1 });
    const html = renderToStaticMarkup(createElement(WorkspaceNavigation, { activeView: 'board', decisionCount: 0, onView: () => undefined, status }));
    expect(html).toContain('aria-label="Projektstatus"');
    expect(html).toContain('1</strong> Agentenlauf aktiv');
    expect(html).toContain('1</strong> aktive Karte');
    expect(html).not.toContain('heute erledigt');
  });
});
