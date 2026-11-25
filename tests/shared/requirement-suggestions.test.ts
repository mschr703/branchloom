import { describe, expect, it } from 'vitest';
import { explicitOppositeRequirement } from '../../src/shared/requirement-conflicts';

describe('explicit opposite requirement wording', () => {
  it('requires the same whole sentence except one opposing English or German modal', () => {
    expect(explicitOppositeRequirement('Navigation must be visible at widths up to 768 px.', 'Navigation must not be visible at widths up to 768 px.'))
      .toEqual({ first: 'required', second: 'forbidden' });
    expect(explicitOppositeRequirement('Die Navigation muss bei 768 px sichtbar sein.', 'Die Navigation darf nicht bei 768 px sichtbar sein.'))
      .toEqual({ first: 'required', second: 'forbidden' });
  });

  it('rejects differing scopes, ambiguous negation, multiple modals and mere similarity', () => {
    expect(explicitOppositeRequirement('Navigation must be visible on mobile.', 'Navigation must not be visible on desktop.')).toBeNull();
    expect(explicitOppositeRequirement('Die Navigation muss nicht sichtbar sein.', 'Die Navigation muss sichtbar sein.')).toBeNull();
    expect(explicitOppositeRequirement('The page must load and must show navigation.', 'The page must not load and must show navigation.')).toBeNull();
    expect(explicitOppositeRequirement('Navigation is always visible at 768 px.', 'Navigation is hidden at 768 px.')).toBeNull();
    expect(explicitOppositeRequirement('Navigation must be visible at 768 px.', 'Die Navigation darf nicht bei 768 px sichtbar sein.')).toBeNull();
  });
});
