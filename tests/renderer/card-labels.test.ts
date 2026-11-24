import { describe, expect, it } from 'vitest';
import { addCardLabel, labelSuggestions } from '../../src/renderer/card-labels';

describe('card label editing', () => {
  it('adds a new label and reuses an existing one without a duplicate', () => {
    expect(addCardLabel(['Planung'], '  Bug  ')).toEqual(['Planung', 'Bug']);
    expect(addCardLabel(['Planung'], 'planung')).toEqual(['Planung']);
  });

  it('rejects invalid labels before saving a card', () => {
    expect(() => addCardLabel([], '')).toThrow('Labelnamen');
    expect(() => addCardLabel([], 'A,B')).toThrow('ohne Komma');
    expect(() => addCardLabel([], 'X'.repeat(33))).toThrow('1–32 Zeichen');
    expect(() => addCardLabel(Array.from({ length: 12 }, (_, index) => `L${index}`), 'another')).toThrow('Höchstens 12 Labels');
  });

  it('suggests only unused labels from real project cards', () => {
    const cards = [{ labels: ['Bug', 'Planung'] }, { labels: ['bug', 'Review'] }];
    expect(labelSuggestions(cards, ['Planung'])).toEqual(['Bug', 'Review']);
  });
});
