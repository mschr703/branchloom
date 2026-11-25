import type { ComponentCandidate } from './component-catalog';

export interface ComponentMatchEvidence {
  cardTerm: string;
  sourceTerm: string;
  cardField: 'title' | 'description';
  sourceField: 'export' | 'path';
  rule: 'same-word' | 'fixed-ui-term';
}

export interface ComponentRecommendation {
  candidate: ComponentCandidate;
  evidence: ComponentMatchEvidence[];
}

export interface ComponentRecommendationResult {
  cardId: string;
  projectId: string;
  cardRevision: number;
  scannedFiles: number;
  partial: boolean;
  notes: string[];
  recommendations: ComponentRecommendation[];
}

const COMMON = new Set([
  'add', 'an', 'and', 'app', 'application', 'aufgabe', 'baue', 'bauen', 'build', 'component', 'components',
  'create', 'das', 'dem', 'den', 'der', 'die', 'ein', 'eine', 'einen', 'einfach', 'for', 'für', 'implement',
  'implementiere', 'in', 'is', 'it', 'lib', 'mit', 'new', 'on', 'our', 'pages', 'please', 'screen', 'seite',
  'src', 'the', 'this', 'to', 'ui', 'und', 'von', 'wir', 'with', 'you',
].map((word) => fold(word)));

/** Only these small, visible vocabulary rules bridge German task text to English UI names. */
const FIXED_UI_TERMS: Record<string, string[]> = {
  einstellung: ['settings'], einstellungen: ['settings'], einstellungsdialog: ['settings', 'dialog'],
  bestatigung: ['confirm'], bestatigungsdialog: ['confirm', 'dialog'], bestaetigung: ['confirm'],
  bestaetigungsdialog: ['confirm', 'dialog'], anmeldedialog: ['login', 'dialog'],
  anmeldung: ['login'], knopf: ['button'], knoepfe: ['button'], formular: ['form'],
  dialogs: ['dialog'], buttons: ['button'], forms: ['form'],
};

function fold(value: string): string {
  return value.toLocaleLowerCase('de-DE').normalize('NFKD').replace(/\p{M}/gu, '');
}

function words(value: string): string[] {
  const separated = value.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  return (fold(separated).match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length >= 3 && !COMMON.has(word));
}

function cardWords(text: string, field: ComponentMatchEvidence['cardField']): Array<{ term: string; canonical: string; field: ComponentMatchEvidence['cardField']; rule: ComponentMatchEvidence['rule'] }> {
  return words(text.slice(0, field === 'title' ? 200 : 2_000)).flatMap<{ term: string; canonical: string; field: ComponentMatchEvidence['cardField']; rule: ComponentMatchEvidence['rule'] }>((term) => {
    const alias = FIXED_UI_TERMS[term];
    return alias ? alias.map((canonical) => ({ term, canonical, field, rule: 'fixed-ui-term' as const }))
      : [{ term, canonical: term, field, rule: 'same-word' as const }];
  });
}

export function recommendComponentsFromCard(title: string, description: string, candidates: ComponentCandidate[]): ComponentRecommendation[] {
  const fromCard = [...cardWords(title, 'title'), ...cardWords(description, 'description')];
  const ranked = candidates.map((candidate) => {
    const name = new Set(words(candidate.name));
    const path = new Set(words(candidate.path.replace(/\.(?:tsx|jsx)$/i, '')));
    const evidence: ComponentMatchEvidence[] = [];
    const seen = new Set<string>();
    for (const item of fromCard) {
      if (seen.has(item.canonical)) continue;
      const sourceField = name.has(item.canonical) ? 'export' : path.has(item.canonical) ? 'path' : null;
      if (!sourceField) continue;
      seen.add(item.canonical);
      evidence.push({ cardTerm: item.term, sourceTerm: item.canonical, cardField: item.field, sourceField, rule: item.rule });
    }
    const score = evidence.reduce((sum, item) => sum + (item.cardField === 'title' ? 2 : 1) + (item.sourceField === 'export' ? 2 : 1), 0);
    return { candidate, evidence, score };
  }).filter(({ evidence }) => evidence.length >= 2 && evidence.some((item) => item.cardField === 'title') && evidence.some((item) => item.sourceField === 'export'));
  ranked.sort((a, b) => b.score - a.score || b.evidence.length - a.evidence.length || a.candidate.path.localeCompare(b.candidate.path));
  return ranked.slice(0, 6).map(({ candidate, evidence }) => ({ candidate, evidence }));
}
