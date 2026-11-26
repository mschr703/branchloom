import { describe, expect, it } from 'vitest';
import { wireframeDrawBounds, wireframeTextBounds } from '../../src/renderer/components/wireframe-drawing';

describe('wireframeDrawBounds', () => {
  it('normalizes a reverse drag without changing its line direction', () => {
    expect(wireframeDrawBounds({ x: 200, y: 180 }, { x: 40, y: 70 }, 390, 844, false)).toEqual({ x: 40, y: 70, width: 160, height: 110, lineDirection: 'falling' });
    expect(wireframeDrawBounds({ x: 40, y: 180 }, { x: 200, y: 70 }, 390, 844, false)?.lineDirection).toBe('rising');
  });

  it('snaps both corners and stays inside a mobile artboard', () => {
    expect(wireframeDrawBounds({ x: 13, y: 19 }, { x: 500, y: 900 }, 390, 844, true)).toEqual({ x: 16, y: 16, width: 374, height: 828, lineDirection: 'falling' });
  });

  it('rejects a click, an undersized drag and invalid coordinates', () => {
    expect(wireframeDrawBounds({ x: 30, y: 30 }, { x: 30, y: 30 }, 960, 600, false)).toBeNull();
    expect(wireframeDrawBounds({ x: 30, y: 30 }, { x: 49, y: 99 }, 960, 600, false)).toBeNull();
    expect(wireframeDrawBounds({ x: 30, y: 30 }, { x: 53, y: 80 }, 960, 600, true)).toBeNull();
    expect(wireframeDrawBounds({ x: Number.NaN, y: 30 }, { x: 80, y: 80 }, 960, 600, false)).toBeNull();
  });

  it('places a clicked text box on the artboard, even near an edge', () => {
    expect(wireframeTextBounds({ x: 100, y: 80 }, 960, 600, true)).toEqual({ x: 104, y: 80, width: 240, height: 42, lineDirection: 'falling' });
    expect(wireframeTextBounds({ x: 389, y: 842 }, 390, 844, false)).toEqual({ x: 150, y: 802, width: 240, height: 42, lineDirection: 'falling' });
    expect(wireframeTextBounds({ x: Number.NaN, y: 80 }, 960, 600, false)).toBeNull();
  });
});
