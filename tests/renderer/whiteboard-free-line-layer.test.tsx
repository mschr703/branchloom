// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhiteboardFreeLineLayer, freeLinePath, type WhiteboardFreeLineView } from '../../src/renderer/components/WhiteboardFreeLineLayer';
import { MAX_WHITEBOARD_FREE_LINE_LENGTH } from '../../src/shared/whiteboard-free-line';

vi.mock('@xyflow/react', () => ({ ViewportPortal: ({ children }: { children: React.ReactNode }) => children }));

const line: WhiteboardFreeLineView = {
  id: 'synthetic-line', x1: 10, y1: 20, x2: 110, y2: 80,
  lineStyle: 'dashed', endMarker: 'arrow', label: 'Review',
};

afterEach(() => { document.body.replaceChildren(); });

describe('Whiteboard free-line layer', () => {
  it('uses a straight bounded path with a separate arrow and flow-positioned SVG', () => {
    const path = freeLinePath(line);
    expect(path).toMatchObject({ left: -8, top: 2, width: 136, height: 96 });
    expect(path.visible).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    expect(path.arrow).toMatch(/^M [\d.]+ [\d.]+ L /);
    expect(path.hit).toBe('M 18 18 L 118 78');
  });

  it('selects saved lines by pointer or keyboard while a draft has no hit target', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    const onSelect = vi.fn();
    const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const oversized = { ...line, id: 'oversized', x1: 0, y1: 0, x2: MAX_WHITEBOARD_FREE_LINE_LENGTH + 1, y2: 0 };
      await act(async () => { root.render(<WhiteboardFreeLineLayer lines={[line, oversized]} draft={{ ...line, x1: 220, x2: 320 }} selectedId={line.id} onSelect={onSelect} />); });
      expect(mount.querySelectorAll('.wb-free-line')).toHaveLength(2);
      expect(mount.querySelectorAll('.wb-free-line-hit')).toHaveLength(1);
      const target = mount.querySelector<SVGPathElement>('.wb-free-line-hit')!;
      expect(target.getAttribute('aria-pressed')).toBe('true');
      expect(target.getAttribute('aria-label')).toContain('Review');
      expect(mount.querySelector('.wb-free-line-stroke')?.getAttribute('stroke-dasharray')).toBe('6 4');
      await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
      await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
      expect(onSelect).toHaveBeenCalledTimes(3);
      expect(onSelect).toHaveBeenCalledWith('synthetic-line');
    } finally {
      await act(async () => { root.unmount(); });
      if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct);
      else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    }
  });
});
