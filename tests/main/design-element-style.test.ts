import { describe, expect, it } from 'vitest';
import { normalizeDesignElementStyle } from '../../src/shared/design-element-style';

describe('bounded live element style', () => {
  it('normalizes literal colors and CSS pixel values', () => {
    expect(normalizeDesignElementStyle({ color: '#AABBCC', backgroundColor: '#010203', borderRadius: '12.0px', fontSize: '16px' }))
      .toEqual({ color: '#aabbcc', backgroundColor: '#010203', borderRadius: '12px', fontSize: '16px' });
  });

  it.each([
    {}, { color: 'red' }, { color: 'url(https://example.com)' }, { color: 'var(--secret)' },
    { color: '#fff' }, { borderRadius: '65px' }, { fontSize: '7px' },
    { fontSize: '20.55px' }, { opacity: '0' }, { color: '#123456', backgroundColor: '' },
  ])('rejects unsupported or unsafe style input %j', (input) => {
    expect(() => normalizeDesignElementStyle(input)).toThrow();
  });
});
