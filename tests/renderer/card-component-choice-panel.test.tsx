import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CardComponentChoicePanel, ComponentRecommendationList } from '../../src/renderer/components/CardComponentChoicePanel';

describe('card component references', () => {
  it('keeps source search optional and states the real local-app prerequisite for variants', () => {
    const html = renderToStaticMarkup(createElement(CardComponentChoicePanel, { cardId: 'card', projectId: 'project', archived: false }));
    expect(html).toContain('Komponentenreferenzen');
    expect(html).toContain('Alle Quellen durchsuchen');
    expect(html).toContain('Aus Kartentext vorschlagen');
    expect(html).toContain('Projektcode wird für diese Auswahl nicht ausgeführt');
    expect(html).toContain('laufende Projekt-App eine lokale Beispielroute');
    expect(html).not.toContain('gerenderte Komponentenbibliothek');
  });

  it('shows a traceable word match and an explicit inspect step', () => {
    const html = renderToStaticMarkup(createElement(ComponentRecommendationList, {
      result: { cardId: 'card', projectId: 'project', cardRevision: 2, scannedFiles: 3, partial: false, notes: [], recommendations: [{
        candidate: { name: 'SettingsDialog', path: 'src/SettingsDialog.tsx', line: 5, kind: 'function', sourceFingerprint: 'a'.repeat(64) },
        evidence: [{ cardTerm: 'einstellungsdialog', sourceTerm: 'settings', cardField: 'title', sourceField: 'export', rule: 'fixed-ui-term' },
          { cardTerm: 'einstellungsdialog', sourceTerm: 'dialog', cardField: 'title', sourceField: 'export', rule: 'fixed-ui-term' }],
      }] }, disabled: false, selectedKeys: [], onInspect: () => {},
    }));
    expect(html).toContain('SettingsDialog');
    expect(html).toContain('src/SettingsDialog.tsx:5');
    expect(html).toContain('SHA-256 aaaaaaaaaaaa');
    expect(html).toContain('feste UI-Wortregel');
    expect(html).toContain('Prüfen');
    expect(html).not.toContain('Referenz übernehmen');
  });
});
