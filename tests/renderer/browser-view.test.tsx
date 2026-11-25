import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrowserDiagnostics, BrowserView } from '../../src/renderer/components/BrowserView';
import type { BrowserDiagnostic, ProjectSnapshot } from '../../src/shared/types';

describe('browser controls', () => {
  it('renders a real address form and clear navigation actions', () => {
    const html = renderToStaticMarkup(createElement(BrowserView, { active: true }));
    expect(html).toContain('aria-label="Browser"');
    expect(html).toContain('id="browser-url"');
    expect(html).toContain('aria-label="Zurück"');
    expect(html).toContain('aria-label="Vorwärts"');
    expect(html).toContain('aria-label="Neu laden"');
    expect(html).toContain('aria-label="Screenshot in Zwischenablage kopieren"');
    expect(html).toContain('aria-label="Im Standardbrowser öffnen"');
    expect(html).toContain('Öffnen');
    expect(html).toContain('aria-label="Browser-Tabs"');
    expect(html).toContain('aria-label="Neuer Tab"');
    expect(html).toContain('Kartenagenten erhalten keinen Zugriff auf diese Tabs');
    expect(html).toContain('unter Einstellungen');
    expect(html).not.toContain('Browser-Einstellungen öffnen');
    const withSettings = renderToStaticMarkup(createElement(BrowserView, { active: true, onOpenSettings: () => undefined }));
    expect(withSettings).toContain('Browser-Einstellungen öffnen');
  });

  it('shows an observed source and requires a deliberate card action', () => {
    const diagnostic: BrowserDiagnostic = { id: 'd1', kind: 'console', message: 'TypeError: failed', pageUrl: 'http://localhost:5173/page', sourceUrl: 'http://localhost:5173/app.ts', line: 7, capturedAt: '2026-11-23T12:00:00Z' };
    const project: ProjectSnapshot = {
      project: { id: 'p1', name: 'Synthetic', path: 'synthetic', createdAt: '' },
      columns: [{ id: 'todo', projectId: 'p1', name: 'To Do', position: 0, autoStart: false, agentId: null, model: null, effort: null }],
      cards: [], agents: [], sessions: [], workflows: [], notes: [],
      queue: { projectId: 'p1', state: 'off', templateWorkflowId: null, activeWorkflowId: null, pauseReason: null, completedCount: 0, updatedAt: null },
    };
    const props = { diagnostics: [diagnostic], selectedId: 'd1', columnId: 'todo', reproduction: 'Open page', saving: false, onSelect: () => undefined, onColumn: () => undefined, onReproduction: () => undefined, onCreate: () => undefined };
    const html = renderToStaticMarkup(createElement(BrowserDiagnostics, { ...props, snapshot: project }));
    expect(html).toContain('TypeError: failed');
    expect(html).toContain('http://localhost:5173/app.ts:7');
    expect(html).toContain('Open page');
    expect(html).toContain('Als Karte anlegen');
    expect(html).toContain('erst auf deinen Klick');
    const withoutProject = renderToStaticMarkup(createElement(BrowserDiagnostics, { ...props, snapshot: null }));
    expect(withoutProject).toContain('disabled');
    expect(withoutProject).toContain('Wähle zuerst ein Projekt');
  });
});
