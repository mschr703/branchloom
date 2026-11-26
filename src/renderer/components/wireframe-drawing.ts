import type { WireframePoint } from './wireframe-selection';

export type WireframeDrawKind = 'panel' | 'text' | 'ellipse' | 'line';

export interface WireframeDrawBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  lineDirection: 'falling' | 'rising';
}

const clamp = (value: number, limit: number): number => Math.max(0, Math.min(limit, value));

/** Returns artboard-pixel geometry only when a drag can make a valid element. */
export function wireframeDrawBounds(
  start: WireframePoint,
  end: WireframePoint,
  canvasWidth: number,
  canvasHeight: number,
  snapToGrid: boolean,
): WireframeDrawBounds | null {
  if (![start.x, start.y, end.x, end.y, canvasWidth, canvasHeight].every(Number.isFinite) || canvasWidth < 24 || canvasHeight < 24) return null;
  if (Math.abs(end.x - start.x) < 24 || Math.abs(end.y - start.y) < 24) return null;
  const step = snapToGrid ? 8 : 1;
  const x1 = clamp(Math.round(start.x / step) * step, canvasWidth);
  const y1 = clamp(Math.round(start.y / step) * step, canvasHeight);
  const x2 = clamp(Math.round(end.x / step) * step, canvasWidth);
  const y2 = clamp(Math.round(end.y / step) * step, canvasHeight);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  if (width < 24 || height < 24) return null;
  return {
    x: Math.min(x1, x2), y: Math.min(y1, y2), width, height,
    lineDirection: (end.x - start.x) * (end.y - start.y) < 0 ? 'rising' : 'falling',
  };
}

/** A click with the text tool creates an editable box inside the artboard. */
export function wireframeTextBounds(
  point: WireframePoint,
  canvasWidth: number,
  canvasHeight: number,
  snapToGrid: boolean,
): WireframeDrawBounds | null {
  if (![point.x, point.y, canvasWidth, canvasHeight].every(Number.isFinite) || canvasWidth < 24 || canvasHeight < 24) return null;
  const step = snapToGrid ? 8 : 1;
  const width = Math.min(240, canvasWidth);
  const height = Math.min(42, canvasHeight);
  return {
    x: clamp(Math.round(point.x / step) * step, canvasWidth - width),
    y: clamp(Math.round(point.y / step) * step, canvasHeight - height),
    width, height, lineDirection: 'falling',
  };
}
