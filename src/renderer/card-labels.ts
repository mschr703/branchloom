import { cardLabels } from '../shared/card-metadata';

export function addCardLabel(existing: string[], input: string): string[] {
  const label = input.trim();
  if (!label) throw new Error('Gib einen Labelnamen ein.');
  if (existing.some((item) => item.toLocaleLowerCase('de-DE') === label.toLocaleLowerCase('de-DE'))) return existing;
  return cardLabels([...existing, label]);
}

export function labelSuggestions(cards: Array<{ labels: string[] }>, current: string[]): string[] {
  const used = new Set(current.map((label) => label.toLocaleLowerCase('de-DE')));
  const found = new Map<string, string>();
  for (const card of cards) for (const label of card.labels) {
    const key = label.toLocaleLowerCase('de-DE');
    if (!used.has(key) && !found.has(key)) found.set(key, label);
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b, 'de-DE')).slice(0, 24);
}
