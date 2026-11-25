import { describe, expect, it } from 'vitest';
import { recommendComponentsFromCard } from '../../src/shared/component-recommendations';
import type { ComponentCandidate } from '../../src/shared/component-catalog';

const candidates: ComponentCandidate[] = [
  { name: 'SettingsDialog', path: 'src/ui/SettingsDialog.tsx', line: 4, kind: 'function', sourceFingerprint: 'a'.repeat(64) },
  { name: 'ConfirmDialog', path: 'src/ui/ConfirmDialog.tsx', line: 2, kind: 'function', sourceFingerprint: 'b'.repeat(64) },
  { name: 'SettingsButton', path: 'src/ui/SettingsButton.tsx', line: 8, kind: 'const', sourceFingerprint: 'c'.repeat(64) },
];

describe('conservative card component recommendations', () => {
  it('matches two actual title words and keeps source evidence', () => {
    const result = recommendComponentsFromCard('Build settings dialog', 'A first screen', candidates);
    expect(result.map((item) => item.candidate.name)).toEqual(['SettingsDialog']);
    expect(result[0]).toMatchObject({ candidate: { path: 'src/ui/SettingsDialog.tsx', line: 4, sourceFingerprint: 'a'.repeat(64) },
      evidence: [{ cardTerm: 'settings', sourceTerm: 'settings', cardField: 'title', sourceField: 'export', rule: 'same-word' },
        { cardTerm: 'dialog', sourceTerm: 'dialog', cardField: 'title', sourceField: 'export', rule: 'same-word' }] });
  });

  it('shows the explicit German UI-word rule without calling it semantic proof', () => {
    const result = recommendComponentsFromCard('Einstellungsdialog bauen', '', candidates);
    expect(result.map((item) => item.candidate.name)).toEqual(['SettingsDialog']);
    expect(result[0]?.evidence.map((item) => item.rule)).toEqual(['fixed-ui-term', 'fixed-ui-term']);
  });

  it('does not recommend on generic or single-word coincidence', () => {
    expect(recommendComponentsFromCard('Build a new screen', 'Please create a component', candidates)).toEqual([]);
    expect(recommendComponentsFromCard('Settings view', 'Use a dialog', candidates).map((item) => item.candidate.name)).toEqual(['SettingsDialog']);
    expect(recommendComponentsFromCard('Settings view', 'No matching export', candidates)).toEqual([]);
  });
});
