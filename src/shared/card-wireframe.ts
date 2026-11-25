export const WIREFRAME_WIDTH = 960;
export const WIREFRAME_HEIGHT = 600;
export const WIREFRAME_ARTBOARDS = {
  desktop: { label: 'Desktop', width: WIREFRAME_WIDTH, height: WIREFRAME_HEIGHT },
  tablet: { label: 'Tablet', width: 768, height: 1024 },
  mobile: { label: 'Mobile', width: 390, height: 844 },
} as const;
export type WireframeArtboard = keyof typeof WIREFRAME_ARTBOARDS;
export type WireframeVariant = Exclude<WireframeArtboard, 'desktop'>;

export type WireframeElementKind = 'panel' | 'text' | 'button' | 'field' | 'ellipse' | 'line';
export type WireframeElementTone = 'plain' | 'muted' | 'accent';
export type WireframeLineDirection = 'falling' | 'rising';

/** Semantic preview colors follow the current Branchloom theme and element tone. */
export const WIREFRAME_THEME_COLORS = { fill: '@fill', stroke: '@stroke', textColor: '@foreground' } as const;

/** Optional overrides keep older drafts and their approvals unchanged. Colors are opaque hex values. */
export interface WireframeElementStyle {
  fill?: string;
  stroke?: string;
  textColor?: string;
  radius?: number;
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700;
}

export function wireframeColorCss(item: WireframeElement, key: keyof typeof WIREFRAME_THEME_COLORS): string | undefined {
  const value = item.style?.[key];
  if (value !== WIREFRAME_THEME_COLORS[key]) return value;
  const accentButton = item.kind === 'button' && item.tone === 'accent';
  if (key === 'stroke') return accentButton ? 'var(--bg)' : 'var(--accent)';
  return key === 'fill' ? accentButton ? 'var(--accent)' : 'var(--surface-2)' : accentButton ? 'var(--bg)' : 'var(--text)';
}

export interface WireframeElement {
  id: string;
  kind: WireframeElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  tone: WireframeElementTone;
  /** A line runs between opposite corners of its bounded box; omitted means falling. */
  lineDirection?: WireframeLineDirection;
  /** Members with the same ID on one artboard form one flat editable group. */
  groupId?: string;
  style?: WireframeElementStyle;
}

/** A deliberately small, testable interaction attached to a desktop wireframe. */
export interface WireframeInteraction {
  triggerElementId: string;
  panelElementId: string;
  trigger: 'click' | 'hover' | 'focus';
  action: 'toggle-panel';
  durationMs: number;
  enterOffsetPx: number;
  closedOpacity: number;
  /** Optional edited entrance frame; older interactions still use a two-point transition. */
  midpoint?: { atPercent: 25 | 50 | 75; offsetPx: number; opacity: number };
  reducedMotionDurationMs: 0;
  focusOnOpen: 'panel';
  focusOnClose: 'trigger';
}

export interface CardWireframe {
  projectId: string;
  cardId: string;
  title: string;
  elements: WireframeElement[];
  artboards: Partial<Record<WireframeVariant, WireframeElement[]>>;
  /** Ordered interactions. Older single-interaction drafts are normalized on read. */
  interactions: WireframeInteraction[];
  /** Compatibility alias for callers that still display the first interaction. */
  interaction: WireframeInteraction | null;
  revision: number;
  approvedRevision: number | null;
  updatedAt: string;
}

export interface SaveCardWireframeInput {
  projectId: string;
  cardId: string;
  expectedRevision: number;
  title: string;
  elements: WireframeElement[];
  /** Omission by older callers preserves already saved variants. */
  artboards?: Partial<Record<WireframeVariant, WireframeElement[]>>;
  /** Omission by older callers preserves the current interaction. */
  interaction?: WireframeInteraction | null;
  /** Preferred representation. An explicit empty list removes every interaction. */
  interactions?: WireframeInteraction[];
}

export interface CardWireframeKey { projectId: string; cardId: string }

/** Unsaved proposal from an explicitly started read-only CLI call. */
export interface WireframeProposal { title: string; elements: WireframeElement[]; sourceCardUpdatedAt: string }
