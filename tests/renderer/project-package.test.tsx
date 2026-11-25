import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectPackageDialog } from '../../src/renderer/components/ProjectPackageDialog';

describe('project package preview', () => {
  it('shows counts, a separate destination and the disabled automation boundary before import', () => {
    const html = renderToStaticMarkup(createElement(ProjectPackageDialog, {
      preview: { fingerprint: 'synthetic', name: 'Demo', columns: 4, cards: 12, notes: 3, workflows: 2 },
      target: { name: 'Demo (Import)', path: '' },
      onTarget: () => undefined,
      onClose: () => undefined,
      onImport: () => undefined,
      onError: () => undefined,
    }));
    expect(html).toContain('4 Spalten · 12 Karten · 3 Notizen · 2 Workflows');
    expect(html).toContain('Es enthält keinen App-Code');
    expect(html).toContain('Agenten, Autostart und Warteschlange bleiben ausgeschaltet');
    expect(html).toContain('Sitzungsprotokolle, Browserdaten und Projektdateien sind nicht enthalten');
    expect(html).toContain('Vorhandener Codeordner');
    expect(html).toContain('Ordner auswählen');
    expect(html).toContain('Als neues Projekt importieren');
    expect(html).toContain('required=""');
  });
});
