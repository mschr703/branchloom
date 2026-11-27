import { ViewportPortal } from '@xyflow/react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { MAX_WHITEBOARD_FREE_LINE_LENGTH } from '../../shared/whiteboard-free-line';
import './whiteboard-free-line-layer.css';

export interface WhiteboardFreeLineView {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lineStyle: 'solid' | 'dashed';
  endMarker: 'none' | 'arrow';
  label: string;
}

export type WhiteboardFreeLineDraftView = Omit<WhiteboardFreeLineView, 'id'>;

interface Props {
  lines: WhiteboardFreeLineView[];
  draft?: WhiteboardFreeLineDraftView | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

const padding = 18;

/** Keep each SVG small so a distant annotation does not cover the flow canvas. */
export function freeLinePath(line: WhiteboardFreeLineDraftView) {
  const left = Math.min(line.x1, line.x2) - padding;
  const top = Math.min(line.y1, line.y2) - padding;
  const width = Math.max(Math.abs(line.x2 - line.x1) + 2 * padding, 2 * padding);
  const height = Math.max(Math.abs(line.y2 - line.y1) + 2 * padding, 2 * padding);
  const x1 = line.x1 - left;
  const y1 = line.y1 - top;
  const x2 = line.x2 - left;
  const y2 = line.y2 - top;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const unitX = length ? (x2 - x1) / length : 0;
  const unitY = length ? (y2 - y1) / length : 0;
  const tipGap = line.endMarker === 'arrow' ? Math.min(7, length / 3) : 0;
  const endX = x2 - unitX * tipGap;
  const endY = y2 - unitY * tipGap;
  const arrow = line.endMarker === 'arrow' && length >= 8
    ? `M ${x2} ${y2} L ${x2 - unitX * 9 - unitY * 4} ${y2 - unitY * 9 + unitX * 4} L ${x2 - unitX * 9 + unitY * 4} ${y2 - unitY * 9 - unitX * 4} Z`
    : null;
  return {
    left, top, width, height,
    visible: `M ${x1} ${y1} L ${endX} ${endY}`,
    hit: `M ${x1} ${y1} L ${x2} ${y2}`,
    arrow,
    labelX: (x1 + x2) / 2,
    labelY: (y1 + y2) / 2 - 7,
  };
}

function FreeLine({ line, selected, draft, onSelect }: { line: WhiteboardFreeLineView | WhiteboardFreeLineDraftView; selected: boolean; draft: boolean; onSelect?: (id: string) => void }) {
  const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  if (!Number.isFinite(length) || length > MAX_WHITEBOARD_FREE_LINE_LENGTH) return null;
  const geometry = freeLinePath(line);
  const id = 'id' in line ? line.id : null;
  const select = () => { if (id) onSelect?.(id); };
  const stopPointer = (event: PointerEvent<SVGPathElement>) => event.stopPropagation();
  const stopClick = (event: MouseEvent<SVGPathElement>) => { event.stopPropagation(); select(); };
  const selectByKeyboard = (event: KeyboardEvent<SVGPathElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    select();
  };
  return <svg className={`wb-free-line${selected ? ' is-selected' : ''}${draft ? ' is-draft' : ''}`}
    style={{ left: geometry.left, top: geometry.top, width: geometry.width, height: geometry.height }}
    viewBox={`0 0 ${geometry.width} ${geometry.height}`} overflow="visible">
    <path className="wb-free-line-stroke" d={geometry.visible} strokeDasharray={line.lineStyle === 'dashed' ? '6 4' : undefined} />
    {geometry.arrow ? <path className="wb-free-line-arrow" d={geometry.arrow} /> : null}
    {line.label ? <text className="wb-free-line-label" x={geometry.labelX} y={geometry.labelY} textAnchor="middle">{line.label}</text> : null}
    {!draft && id ? <path className="wb-free-line-hit" d={geometry.hit} strokeWidth={14} role="button" tabIndex={0}
      aria-label={line.label ? `Freie Linie: ${line.label}` : 'Freie Linie'} aria-pressed={selected}
      onPointerDown={stopPointer} onClick={stopClick} onKeyDown={selectByKeyboard} /> : null}
  </svg>;
}

/** Render free annotations in flow coordinates without making the whole overlay interactive. */
export function WhiteboardFreeLineLayer({ lines, draft = null, selectedId = null, onSelect }: Props) {
  return <ViewportPortal><div className="wb-free-line-layer">
    {lines.map((line) => <FreeLine key={line.id} line={line} selected={line.id === selectedId} draft={false} onSelect={onSelect} />)}
    {draft ? <FreeLine line={draft} selected={false} draft /> : null}
  </div></ViewportPortal>;
}
