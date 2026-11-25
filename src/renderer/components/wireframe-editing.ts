import type { WireframeElement, WireframeElementStyle, WireframeInteraction, WireframeVariant } from '../../shared/card-wireframe';
import { WIREFRAME_HEIGHT, WIREFRAME_WIDTH } from '../../shared/card-wireframe';

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/** Explicit type size is stored in artboard pixels; cqw scales with its rendered canvas width. */
export function wireframePreviewFontSize(fontSize: number | undefined, canvasWidth: number): string | undefined {
  return fontSize === undefined ? undefined : `${fontSize * 100 / canvasWidth}cqw`;
}

/** Snap the pointer result, then keep the full item inside the artboard. */
export function snapWireframePosition(value: number, size: number, limit: number, grid = 8): number {
  return clamp(Math.round(value / grid) * grid, 0, limit - size);
}

/** Compare visible content, independent of the key order returned by SQLite validation. */
function sameElements(left: WireframeElement[], right: WireframeElement[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return other !== undefined && item.id === other.id && item.kind === other.kind && item.tone === other.tone && (item.lineDirection ?? 'falling') === (other.lineDirection ?? 'falling') && (item.groupId ?? '') === (other.groupId ?? '') &&
      item.text === other.text && item.x === other.x && item.y === other.y && item.width === other.width && item.height === other.height &&
      sameStyle(item.style, other.style);
  });
}

function sameStyle(left?: WireframeElementStyle, right?: WireframeElementStyle): boolean {
  return (['fill', 'stroke', 'textColor', 'radius', 'fontSize', 'fontWeight'] as const).every((key) => left?.[key] === right?.[key]);
}

export function sameWireframeContent(
  draft: { title: string; elements: WireframeElement[]; artboards?: Partial<Record<WireframeVariant, WireframeElement[]>>; interactions?: WireframeInteraction[]; interaction?: WireframeInteraction | null },
  saved: { title: string; elements: WireframeElement[]; artboards?: Partial<Record<WireframeVariant, WireframeElement[]>>; interactions?: WireframeInteraction[]; interaction?: WireframeInteraction | null } | null,
): boolean {
  const draftInteractions = draft.interactions ?? (draft.interaction ? [draft.interaction] : []);
  const savedInteractions = saved?.interactions ?? (saved?.interaction ? [saved.interaction] : []);
  if (!saved || draft.title !== saved.title || !sameElements(draft.elements, saved.elements) || JSON.stringify(draftInteractions) !== JSON.stringify(savedInteractions)) return false;
  return (['tablet', 'mobile'] as const).every((name) => {
    const left = draft.artboards?.[name];
    const right = saved.artboards?.[name];
    return left === undefined || right === undefined ? left === right : sameElements(left, right);
  });
}

export function resizeWireframeElement(item: WireframeElement, deltaWidth: number, deltaHeight: number, canvasWidth = WIREFRAME_WIDTH, canvasHeight = WIREFRAME_HEIGHT): WireframeElement {
  return {
    ...item,
    width: clamp(Math.round(item.width + deltaWidth), 24, canvasWidth - item.x),
    height: clamp(Math.round(item.height + deltaHeight), 24, canvasHeight - item.y),
  };
}

export function moveWireframeLayer(elements: WireframeElement[], id: string, direction: -1 | 1): WireframeElement[] {
  const index = elements.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= elements.length) return elements;
  const next = [...elements];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
