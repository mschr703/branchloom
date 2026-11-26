import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type FocusEvent as ReactFocusEvent } from 'react';
import { Check, Circle, Copy, CornerDownRight, Download, Minus, MousePointer2, Plus, Redo2, RotateCcw, Square, Type, Undo2 } from 'lucide-react';
import type { Card } from '../../shared/types';
import type { CardWireframe, WireframeArtboard, WireframeElement, WireframeElementKind, WireframeElementStyle, WireframeElementTone, WireframeInteraction, WireframeVariant } from '../../shared/card-wireframe';
import { WIREFRAME_ARTBOARDS, WIREFRAME_HEIGHT, WIREFRAME_THEME_COLORS, WIREFRAME_WIDTH, wireframeColorCss } from '../../shared/card-wireframe';
import { moveWireframeLayer, resizeWireframeElement, sameWireframeContent, snapWireframePosition, wireframePreviewFontSize } from './wireframe-editing';
import { copyDesktopToArtboard } from './wireframe-artboards';
import { alignWireframeSelection, duplicateWireframeSelection, expandWireframeGroupSelection, moveWireframeSelection, removeWireframeSelection, selectWireframeMarquee, selectWireframeTarget, type WireframeAlignment, type WireframePoint } from './wireframe-selection';
import { WireframeArtboardOverview } from './WireframeArtboardOverview';
import { WireframeComponentLibrary } from './WireframeComponentLibrary';
import { WireframeInteractionEditor } from './WireframeInteractionEditor';
import { appendWireframeComponent, type WireframeComponent } from '../../shared/wireframe-components';
import { wireframePngDataUrl } from './wireframe-export';
import { wireframeDrawBounds, wireframeTextBounds, type WireframeDrawKind } from './wireframe-drawing';
import './task-wireframe.css';
import './task-wireframe-finish.css';

interface Draft { title: string; elements: WireframeElement[]; artboards: CardWireframe['artboards']; interactions: WireframeInteraction[] }
interface MarqueeDrag { pointerId: number; start: WireframePoint; end: WireframePoint; clientX: number; clientY: number; initialIds: string[]; add: boolean }
interface DrawingDrag { pointerId: number; artboard: WireframeArtboard; kind: WireframeDrawKind; start: WireframePoint; end: WireframePoint; clientX: number; clientY: number }
interface Props { projectId: string; cards: Card[]; startCardId?: string | null; focusMode: boolean; focusPending?: boolean; canEnterFocus: boolean; onFocusModeChange: (focus: boolean) => void }
const unsavedDrafts = new Map<string, Draft>();
const lastSelectedCard = new Map<string, string>();
const draftKey = (projectId: string, cardId: string): string => JSON.stringify([projectId, cardId]);

const labelForKind: Record<WireframeElementKind, string> = { panel: 'Fläche', text: 'Text', button: 'Knopf', field: 'Eingabe', ellipse: 'Ellipse', line: 'Linie' };
const isShape = (kind: WireframeElementKind): boolean => kind === 'ellipse' || kind === 'line';
const isTextEditable = (kind: WireframeElementKind): boolean => kind === 'text' || kind === 'button' || kind === 'field';
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const messageOf = (reason: unknown): string => reason instanceof Error ? reason.message : String(reason);
type StyleColorKey = keyof typeof WIREFRAME_THEME_COLORS;

function StyleColorControl({ label, styleKey, item, disabled, onChange }: {
  label: string; styleKey: StyleColorKey; item: WireframeElement; disabled: boolean; onChange: (value?: string) => void;
}) {
  const [, refreshTheme] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => refreshTheme((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const value = item.style?.[styleKey];
  const cssColor = wireframeColorCss({ ...item, style: { ...item.style, [styleKey]: value ?? WIREFRAME_THEME_COLORS[styleKey] } }, styleKey)!;
  const themeHex = cssColor.startsWith('var(') ? getComputedStyle(document.documentElement).getPropertyValue(cssColor.slice(4, -1)).trim() : cssColor;
  const pickerValue = /^#[0-9a-fA-F]{6}$/.test(themeHex) ? themeHex : '#000000';
  return <div className="task-wireframe-color-control">
    <label><input type="checkbox" checked={value !== undefined} disabled={disabled} onChange={(event) => onChange(event.target.checked ? WIREFRAME_THEME_COLORS[styleKey] : undefined)} />{label}</label>
    <input type="color" aria-label={`${label} auswählen`} value={pickerValue} disabled={disabled || value === undefined} onChange={(event) => onChange(event.target.value)} />
    <span>{value?.startsWith('@') ? `Theme · ${pickerValue}` : value ?? 'Standard'}</span>
  </div>;
}

export function starterWireframe(card: Pick<Card, 'title'>): Draft {
  const title = card.title.slice(0, 100);
  return { title, artboards: {}, interactions: [], elements: [
    { id: 'window-header', kind: 'panel', x: 20, y: 20, width: 920, height: 62, text: '', tone: 'muted' },
    { id: 'window-title', kind: 'text', x: 42, y: 35, width: 620, height: 34, text: title.slice(0, 120), tone: 'plain' },
    { id: 'navigation', kind: 'panel', x: 20, y: 100, width: 204, height: 480, text: 'Navigation', tone: 'muted' },
    { id: 'content', kind: 'panel', x: 242, y: 100, width: 698, height: 480, text: 'Inhalt', tone: 'plain' },
    { id: 'section-title', kind: 'text', x: 270, y: 136, width: 480, height: 42, text: 'Übersicht', tone: 'plain' },
    { id: 'primary-action', kind: 'button', x: 744, y: 510, width: 164, height: 44, text: 'Aktion', tone: 'accent' },
  ] };
}

export function TaskWireframeEditor({ projectId, cards, startCardId = null, focusMode, focusPending = false, canEnterFocus, onFocusModeChange }: Props) {
  const initialCardId = [startCardId, lastSelectedCard.get(projectId)].find((id) => id && cards.some((card) => card.id === id)) ?? '';
  const [cardId, setCardId] = useState(initialCardId);
  const [saved, setSaved] = useState<CardWireframe | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [artboard, setArtboard] = useState<WireframeArtboard>('desktop');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(initialCardId));
  const [geometryDraft, setGeometryDraft] = useState<{ id: string; key: 'x' | 'y' | 'width' | 'height'; raw: string } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [panReady, setPanReady] = useState(false);
  const [panning, setPanning] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [styleNumberDraft, setStyleNumberDraft] = useState<{ id: string; key: 'fontSize' | 'radius'; raw: string } | null>(null);
  const [inlineTextEdit, setInlineTextEdit] = useState<{ id: string; artboard: WireframeArtboard; text: string } | null>(null);
  const [marqueeView, setMarqueeView] = useState<{ start: WireframePoint; end: WireframePoint } | null>(null);
  const [drawTool, setDrawTool] = useState<WireframeDrawKind | null>(null);
  const [drawingView, setDrawingView] = useState<DrawingDrag | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [, setHistoryRevision] = useState(0);
  const past = useRef<Draft[]>([]);
  const future = useRef<Draft[]>([]);
  const generation = useRef(0);
  const interactionLocked = useRef(false);
  const stage = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const spaceHeld = useRef(false);
  const pan = useRef<{ pointerId: number; clientX: number; clientY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const zoomRef = useRef(zoom);
  const zoomFrame = useRef<number | null>(null);
  const marquee = useRef<MarqueeDrag | null>(null);
  const drawing = useRef<DrawingDrag | null>(null);
  const drag = useRef<{ id: string; ids: string[]; pointerId: number; clientX: number; clientY: number; before: Draft; origin: WireframeElement[]; scopeGroupId: string | null; recorded: boolean } | null>(null);
  const pointerSelection = useRef(false);
  const inlineEditRef = useRef<typeof inlineTextEdit>(null);
  const inlineInput = useRef<HTMLInputElement>(null);
  const resize = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; width: number; height: number; before: Draft; recorded: boolean } | null>(null);
  const card = cards.find((item) => item.id === cardId) ?? null;
  const canvas = WIREFRAME_ARTBOARDS[artboard];
  const elements = draft ? artboard === 'desktop' ? draft.elements : draft.artboards[artboard] : undefined;
  const selectedId = selectedIds.length === 1 ? selectedIds[0]! : null;
  const selected = elements?.find((item) => item.id === selectedId) ?? null;
  const selectedElements = elements?.filter((item) => selectedIds.includes(item.id)) ?? [];
  const enteredGroupId = editingGroupId && elements?.some((item) => item.groupId === editingGroupId) ? editingGroupId : null;
  const selectedGroupId = selectedElements.length > 1 && selectedElements[0]?.groupId && selectedElements.every((item) => item.groupId === selectedElements[0]?.groupId) ? selectedElements[0].groupId : null;
  const inlineItem = inlineTextEdit?.artboard === artboard ? elements?.find((item) => item.id === inlineTextEdit.id) : undefined;
  const drawPreview = drawingView?.artboard === artboard ? wireframeDrawBounds(drawingView.start, drawingView.end, canvas.width, canvas.height, snapToGrid) : null;
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => {
    if (editingGroupId && !enteredGroupId) { setEditingGroupId(null); setSelectedIds([]); }
  }, [editingGroupId, enteredGroupId]);
  useEffect(() => {
    const target = viewport.current;
    if (!target) return;
    const onWheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
      event.preventDefault();
      const next = clamp(zoomRef.current + (event.deltaY < 0 ? 25 : -25), 50, 150);
      if (next === zoomRef.current || !stage.current) return;
      const before = stage.current.getBoundingClientRect();
      const anchorX = before.width ? (event.clientX - before.left) / before.width : 0.5;
      const anchorY = before.height ? (event.clientY - before.top) / before.height : 0.5;
      zoomRef.current = next;
      setZoom(next);
      if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
      zoomFrame.current = requestAnimationFrame(() => {
        const view = viewport.current; const currentStage = stage.current;
        if (!view || !currentStage) return;
        const after = currentStage.getBoundingClientRect();
        view.scrollLeft += after.left + anchorX * after.width - event.clientX;
        view.scrollTop += after.top + anchorY * after.height - event.clientY;
        zoomFrame.current = null;
      });
    };
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => { target.removeEventListener('wheel', onWheel); if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current); };
  }, [cardId, artboard, Boolean(elements)]);
  useLayoutEffect(() => {
    if (!inlineItem) return;
    inlineInput.current?.focus();
    inlineInput.current?.select();
  }, [inlineItem?.id]);
  function setSelectedId(id: string | null) {
    // Newly added layers are not in the current render's element list yet.
    const item = id ? elements?.find((candidate) => candidate.id === id) : null;
    if (enteredGroupId && item && item.groupId !== enteredGroupId) setEditingGroupId(null);
    setSelectedIds(id ? item ? selectWireframeTarget(elements!, id, enteredGroupId) : [id] : []);
  }
  function toggleSelected(id: string) {
    if (!elements) return;
    const item = elements.find((candidate) => candidate.id === id);
    if (enteredGroupId && item?.groupId !== enteredGroupId) { setEditingGroupId(null); setSelectedIds(selectWireframeTarget(elements, id)); return; }
    if (enteredGroupId) { setSelectedIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]); return; }
    const group = expandWireframeGroupSelection(elements, [id]);
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => !group.includes(item)) : expandWireframeGroupSelection(elements, [...ids, ...group]));
  }
  function enterGroup(id: string, memberId?: string) {
    if (!elements || interactionLocked.current || !elements.some((item) => item.groupId === id)) return;
    setEditingGroupId(id);
    const first = elements.find((item) => item.groupId === id)!;
    setSelectedIds([memberId && elements.some((item) => item.id === memberId && item.groupId === id) ? memberId : first.id]);
  }
  function leaveGroup() {
    if (!enteredGroupId) return;
    setEditingGroupId(null);
    setSelectedIds(elements?.filter((item) => item.groupId === enteredGroupId).map((item) => item.id) ?? []);
  }
  function selectAllInScope() { setSelectedIds(elements?.filter((item) => !enteredGroupId || item.groupId === enteredGroupId).map((item) => item.id) ?? []); }
  function stopPan(pointerId?: number) {
    const current = pan.current;
    if (!current || (pointerId !== undefined && current.pointerId !== pointerId)) return;
    pan.current = null; setPanning(false);
    if (viewport.current?.hasPointerCapture(current.pointerId)) viewport.current.releasePointerCapture(current.pointerId);
  }
  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (pan.current || interactionLocked.current || inlineEditRef.current || event.pointerType === 'touch' || !(event.button === 1 || (event.button === 0 && spaceHeld.current))) return;
    event.preventDefault();
    pan.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  }
  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const current = pan.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = current.scrollLeft - (event.clientX - current.clientX);
    event.currentTarget.scrollTop = current.scrollTop - (event.clientY - current.clientY);
  }
  function onCanvasKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.code !== 'Space' || (event.target !== viewport.current && event.target !== stage.current) || inlineEditRef.current) return;
    event.preventDefault();
    if (!spaceHeld.current) { spaceHeld.current = true; setPanReady(true); }
  }
  function onCanvasKeyUp(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.code !== 'Space') return;
    spaceHeld.current = false; setPanReady(false);
  }
  function onCanvasBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    spaceHeld.current = false; setPanReady(false); stopPan();
  }
  function pointOnStage(event: ReactPointerEvent<HTMLDivElement>): WireframePoint | null {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: clamp((event.clientX - rect.left) * canvas.width / rect.width, 0, canvas.width),
      y: clamp((event.clientY - rect.top) * canvas.height / rect.height, 0, canvas.height),
    };
  }
  function cancelMarquee() {
    const current = marquee.current;
    marquee.current = null; setMarqueeView(null);
    if (current && stage.current?.hasPointerCapture(current.pointerId)) stage.current.releasePointerCapture(current.pointerId);
  }
  function cancelDrawing() {
    const current = drawing.current;
    drawing.current = null; setDrawingView(null);
    if (current && stage.current?.hasPointerCapture(current.pointerId)) stage.current.releasePointerCapture(current.pointerId);
  }
  function moveDrawing(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const end = pointOnStage(event);
    if (!end) return;
    current.end = end;
    setDrawingView({ ...current });
  }
  function finishDrawing(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drawing.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const end = pointOnStage(event) ?? current.end;
    const moved = Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= 8;
    const geometry = moved ? wireframeDrawBounds(current.start, end, canvas.width, canvas.height, snapToGrid)
      : current.kind === 'text' ? wireframeTextBounds(current.start, canvas.width, canvas.height, snapToGrid) : null;
    cancelDrawing();
    if (!geometry || !draft || !elements || current.artboard !== artboard || interactionLocked.current || elements.length >= 40) return;
    const item: WireframeElement = {
      id: `item-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      kind: current.kind, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height,
      text: current.kind === 'panel' ? 'Bereich' : current.kind === 'text' ? 'Text' : '', tone: 'plain',
      ...(current.kind === 'line' ? { lineDirection: geometry.lineDirection } : {}),
      ...(enteredGroupId ? { groupId: enteredGroupId } : {}),
    };
    editElements([...elements, item]);
    setSelectedIds([item.id]);
    if (item.kind === 'text') updateInlineTextEdit({ id: item.id, artboard, text: item.text });
  }
  function startMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.button !== 0 || interactionLocked.current || inlineEditRef.current || spaceHeld.current || pan.current) return;
    if (drawTool) {
      if (event.pointerType === 'touch') return;
      if (!elements || elements.length >= 40) { setNotice('Auf dieser Zeichenfläche sind höchstens 40 Elemente erlaubt.'); return; }
      const start = pointOnStage(event);
      if (!start) return;
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drawing.current = { pointerId: event.pointerId, artboard, kind: drawTool, start, end: start, clientX: event.clientX, clientY: event.clientY };
      setDrawingView({ ...drawing.current });
      return;
    }
    if (event.pointerType === 'touch') { setSelectedId(null); return; }
    const start = pointOnStage(event);
    if (!start) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    marquee.current = { pointerId: event.pointerId, start, end: start, clientX: event.clientX, clientY: event.clientY, initialIds: event.shiftKey ? selectedIds : [], add: event.shiftKey };
    setMarqueeView({ start, end: start });
  }
  function moveMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawing.current) { moveDrawing(event); return; }
    const current = marquee.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const end = pointOnStage(event);
    if (!end) return;
    current.end = end;
    setMarqueeView({ start: current.start, end });
  }
  function finishMarquee(event: ReactPointerEvent<HTMLDivElement>) {
    if (drawing.current) { finishDrawing(event); return; }
    const current = marquee.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const end = pointOnStage(event) ?? current.end;
    const moved = Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= 4;
    if (moved && elements) setSelectedIds(selectWireframeMarquee(elements, current.start, end, current.initialIds, enteredGroupId));
    else if (!current.add) setSelectedId(null);
    cancelMarquee();
  }
  function updateInlineTextEdit(next: typeof inlineTextEdit) { inlineEditRef.current = next; setInlineTextEdit(next); }
  function startInlineTextEdit(item: WireframeElement) {
    if (interactionLocked.current || !elements || !isTextEditable(item.kind)) return;
    drag.current = null; resize.current = null;
    if (item.groupId && enteredGroupId !== item.groupId) enterGroup(item.groupId, item.id);
    else setSelectedId(item.id);
    updateInlineTextEdit({ id: item.id, artboard, text: item.text });
  }
  function finishInlineTextEdit(commit: boolean, restoreFocus = true) {
    const current = inlineEditRef.current;
    if (!current) return;
    updateInlineTextEdit(null);
    if (commit && current.artboard === artboard && elements?.some((item) => item.id === current.id)) {
      editElement(current.id, { text: current.text.slice(0, 120).replace(/\0/g, '') });
    }
    if (restoreFocus) requestAnimationFrame(() => {
      // An older edit may finish its focus callback after a new F2/double-click
      // already focused the replacement input. Do not steal that input's focus.
      if (inlineEditRef.current) return;
      [...(stage.current?.querySelectorAll<HTMLElement>('[data-wireframe-id]') ?? [])]
        .find((item) => item.dataset.wireframeId === current.id)?.focus();
    });
  }
  function selectionFor(next: Draft): WireframeElement[] { return artboard === 'desktop' ? next.elements : next.artboards[artboard] ?? []; }

  function editElements(next: WireframeElement[], record = true) {
    if (!draft) return;
    const interactions = draft.interactions.filter((interaction) => next.some((item) => item.id === interaction.triggerElementId && item.kind === 'button') && next.some((item) => item.id === interaction.panelElementId && item.kind === 'panel'));
    edit(artboard === 'desktop' ? { ...draft, elements: next, interactions } : { ...draft, artboards: { ...draft.artboards, [artboard]: next } }, record);
  }
  function createArtboard(target: WireframeVariant, fromDesktop: boolean) {
    if (!draft || interactionLocked.current || draft.artboards[target]) return;
    edit({ ...draft, artboards: { ...draft.artboards, [target]: fromDesktop ? copyDesktopToArtboard(draft.elements, target) : [] } });
    setSelectedId(null);
  }
  function removeArtboard(target: WireframeVariant) {
    if (!draft || interactionLocked.current || draft.artboards[target] === undefined) return;
    const next = { ...draft.artboards }; delete next[target];
    edit({ ...draft, artboards: next }); setSelectedId(null);
  }

  function switchArtboard(target: WireframeArtboard) {
    cancelMarquee();
    cancelDrawing();
    drag.current = null; resize.current = null;
    updateInlineTextEdit(null);
    setArtboard(target); setEditingGroupId(null); setSelectedIds([]); setGeometryDraft(null); setStyleNumberDraft(null);
  }

  function resetHistory() { past.current = []; future.current = []; setHistoryRevision((value) => value + 1); }
  function recordHistory(before: Draft) {
    past.current = [...past.current.slice(-49), before];
    future.current = [];
    setHistoryRevision((value) => value + 1);
  }
  function undo() {
    if (!draft || !past.current.length || interactionLocked.current) return;
    const previous = past.current[past.current.length - 1]!;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current.slice(-49), draft];
    retainDraft(previous); setGeometryDraft(null); setStyleNumberDraft(null); updateInlineTextEdit(null);
    if (enteredGroupId && !selectionFor(previous).some((item) => item.groupId === enteredGroupId)) setEditingGroupId(null);
    setSelectedIds((ids) => ids.filter((id) => selectionFor(previous).some((item) => item.id === id)));
    setHistoryRevision((value) => value + 1);
  }
  function redo() {
    if (!draft || !future.current.length || interactionLocked.current) return;
    const next = future.current[future.current.length - 1]!;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current.slice(-49), draft];
    retainDraft(next); setGeometryDraft(null); setStyleNumberDraft(null); updateInlineTextEdit(null);
    if (enteredGroupId && !selectionFor(next).some((item) => item.groupId === enteredGroupId)) setEditingGroupId(null);
    setSelectedIds((ids) => ids.filter((id) => selectionFor(next).some((item) => item.id === id)));
    setHistoryRevision((value) => value + 1);
  }

  async function load(targetCardId: string, expectedGeneration = generation.current) {
    cancelMarquee();
    cancelDrawing();
    interactionLocked.current = true;
    setLoading(true); setError(''); setNotice('');
    try {
      const current = await window.studio.cardWireframe({ projectId, cardId: targetCardId });
      if (generation.current !== expectedGeneration) return;
      const retained = unsavedDrafts.get(draftKey(projectId, targetCardId));
      setSaved(current); setDraft(retained ?? (current ? { title: current.title, elements: current.elements, artboards: current.artboards, interactions: current.interactions } : null));
      setEditingGroupId(null); setSelectedIds([]); setDirty(Boolean(retained)); setGeometryDraft(null); setStyleNumberDraft(null); updateInlineTextEdit(null);
      resetHistory();
      if (retained) setNotice('Ungespeicherter Entwurf aus dieser App-Sitzung wiederhergestellt.');
    } catch (reason) { if (generation.current === expectedGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === expectedGeneration) { interactionLocked.current = false; setLoading(false); } }
  }

  useEffect(() => {
    const current = ++generation.current;
    cancelDrawing(); setDrawTool(null);
    interactionLocked.current = false; setBusy(false);
    setSaved(null); setDraft(null); setEditingGroupId(null); setSelectedIds([]); setArtboard('desktop'); setDirty(false); setError(''); setNotice(''); updateInlineTextEdit(null);
    resetHistory();
    if (cardId && cards.some((item) => item.id === cardId)) { lastSelectedCard.set(projectId, cardId); void load(cardId, current); }
    else { if (cardId) setCardId(lastSelectedCard.get(projectId) && cards.some((item) => item.id === lastSelectedCard.get(projectId)) ? lastSelectedCard.get(projectId)! : ''); setLoading(false); }
    return () => { generation.current++; };
  }, [projectId, cardId]);

  function retainDraft(next: Draft) {
    const unchanged = sameWireframeContent(next, saved);
    if (cardId) {
      const key = draftKey(projectId, cardId);
      if (unchanged) unsavedDrafts.delete(key);
      else unsavedDrafts.set(key, next);
    }
    setDraft(next); setDirty(!unchanged);
    setNotice(unchanged ? 'Gespeicherten Stand wiederhergestellt.' : 'Ungespeicherte Änderungen.'); setError('');
  }
  function edit(next: Draft, record = true) { if (!interactionLocked.current) { if (draft && record) recordHistory(draft); retainDraft(next); } }
  function editElement(id: string, change: Partial<WireframeElement>, record = true) {
    if (!draft || !elements) return;
    const current = elements.find((item) => item.id === id);
    if (!current || Object.entries(change).every(([key, value]) => current[key as keyof WireframeElement] === value)) return;
    editElements(elements.map((item) => item.id === id ? { ...item, ...change } : item), record);
  }
  function setStyle(key: keyof WireframeElementStyle, value: string | number | undefined) {
    if (!selected || selected.style?.[key] === value || interactionLocked.current) return;
    const style: WireframeElementStyle = { ...selected.style, [key]: value };
    if (value === undefined) delete style[key];
    editElement(selected.id, { style: Object.keys(style).length ? style : undefined });
  }
  function setStyleNumber(item: WireframeElement, key: 'fontSize' | 'radius', raw: string) {
    if (interactionLocked.current) return;
    setStyleNumberDraft({ id: item.id, key, raw });
    if (raw === '') { setStyle(key, undefined); return; }
    if (!/^\d+$/.test(raw)) return;
    const value = Number(raw);
    if (value >= (key === 'fontSize' ? 8 : 0) && value <= 64) setStyle(key, value);
  }
  function addElement(kind: WireframeElementKind) {
    if (!draft || !elements || interactionLocked.current || elements.length >= 40) return;
    cancelDrawing(); setDrawTool(null);
    const width = kind === 'panel' || kind === 'text' ? 250 : kind === 'line' ? 180 : kind === 'ellipse' ? 120 : 168;
    const height = kind === 'panel' ? 140 : kind === 'ellipse' ? 120 : kind === 'line' ? 70 : kind === 'text' ? 42 : 44;
    const offset = (elements.length % 10) * 18;
    const item: WireframeElement = {
      id: `item-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
      kind, x: clamp(Math.round(canvas.width * .3) + offset, 0, canvas.width - width), y: clamp(220 + offset, 0, canvas.height - height),
      width, height, text: isShape(kind) ? '' : kind === 'panel' ? 'Bereich' : kind === 'field' ? 'Eingabe' : kind === 'button' ? 'Aktion' : 'Text', tone: 'plain',
    };
    editElements([...elements, item]); setEditingGroupId(null); setSelectedIds([item.id]);
  }
  function insertComponent(component: WireframeComponent) {
    if (!elements || interactionLocked.current) return;
    if (component.projectId !== projectId) { setError('Dieser Baustein gehört zu einem anderen Projekt.'); return; }
    if (elements.length + component.elements.length > 40) { setNotice('Auf dieser Zeichenfläche sind höchstens 40 Elemente erlaubt.'); return; }
    const result = appendWireframeComponent(elements, component, canvas.width, canvas.height,
      (kind) => `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`);
    if (!result) { setError('Dieser Baustein lässt sich auf der Zeichenfläche nicht platzieren.'); return; }
    editElements(result.elements);
    setSelectedIds(result.inserted.map((item) => item.id));
    setNotice(`„${component.name}“ als unabhängige Kopie eingefügt. Speichere den Entwurf, um sie zu behalten.`);
  }
  function removeElement(id: string) {
    if (!draft || !elements || interactionLocked.current) return;
    editElements(removeWireframeSelection(elements, [id])); setSelectedId(null);
  }
  function removeSelection() {
    if (!elements || !selectedIds.length || interactionLocked.current) return;
    const ids = new Set(selectedIds);
    editElements(removeWireframeSelection(elements, [...ids]));
    setSelectedId(null);
  }
  function groupSelection() {
    if (!elements || selectedElements.length < 2 || interactionLocked.current) return;
    if (selectedElements[0]!.groupId && selectedElements.every((item) => item.groupId === selectedElements[0]!.groupId)) return;
    const groupId = `group-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
    const ids = new Set(selectedIds);
    editElements(elements.map((item) => ids.has(item.id) ? { ...item, groupId } : item));
  }
  function ungroupSelection() {
    if (!elements || interactionLocked.current) return;
    const groups = new Set(selectedElements.map((item) => item.groupId).filter((id): id is string => Boolean(id)));
    if (!groups.size) return;
    editElements(elements.map((item) => item.groupId && groups.has(item.groupId) ? { ...item, groupId: undefined } : item));
    setEditingGroupId(null);
  }
  function duplicateSelection(focusTarget?: HTMLElement) {
    if (!elements || !selectedIds.length || interactionLocked.current) return;
    const focusRoot = focusTarget?.closest('.task-wireframe-canvas, .task-wireframe-layers');
    const focusIndex = selectedElements.findIndex((item) => item.id === focusTarget?.dataset.wireframeId);
    const next = duplicateWireframeSelection(elements, selectedIds, canvas.width, canvas.height,
      () => `item-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, enteredGroupId);
    if (!next) { setNotice('Auswahl kann nicht dupliziert werden: Diese Zeichenfläche erlaubt höchstens 40 Elemente.'); return; }
    editElements(next.elements);
    setSelectedIds(next.selectedIds);
    const focusId = next.selectedIds[Math.max(focusIndex, 0)];
    if (focusRoot && focusId) requestAnimationFrame(() => {
      [...focusRoot.querySelectorAll<HTMLElement>('[data-wireframe-id]')].find((item) => item.dataset.wireframeId === focusId)?.focus();
    });
  }
  function moveSelected(item: WireframeElement, dx: number, dy: number) {
    if (!elements) return;
    if (selectedIds.length > 1 && selectedIds.includes(item.id)) {
      const next = moveWireframeSelection(elements, selectedIds, dx, dy, canvas.width, canvas.height, enteredGroupId);
      if (next !== elements) editElements(next);
    } else editElement(item.id, { x: clamp(item.x + dx, 0, canvas.width - item.width), y: clamp(item.y + dy, 0, canvas.height - item.height) });
  }
  function alignSelection(mode: WireframeAlignment) {
    if (!elements || interactionLocked.current || selectedElements.some((item) => item.groupId)) return;
    const next = alignWireframeSelection(elements, selectedIds, mode);
    if (next !== elements) editElements(next);
  }
  function changeLayer(id: string, direction: -1 | 1) {
    if (!draft || !elements) return;
    const next = moveWireframeLayer(elements, id, direction);
    if (next !== elements) editElements(next);
  }
  function setGeometry(item: WireframeElement, key: 'x' | 'y' | 'width' | 'height', raw: string) {
    if (interactionLocked.current) return;
    setGeometryDraft({ id: item.id, key, raw });
    if (!/^-?\d+$/.test(raw)) return;
    const value = Number(raw);
    if (!Number.isInteger(value)) return;
    const next = { ...item, [key]: value };
    next.width = clamp(next.width, 24, canvas.width);
    next.height = clamp(next.height, 24, canvas.height);
    next.x = clamp(next.x, 0, canvas.width - next.width);
    next.y = clamp(next.y, 0, canvas.height - next.height);
    editElement(item.id, next);
  }

  async function save() {
    if (!card || !draft || busy || interactionLocked.current || !dirty) return;
    const currentGeneration = generation.current;
    const submittedDraft = draft;
    const key = draftKey(projectId, card.id);
    interactionLocked.current = true;
    setBusy(true); setError('');
    try {
      const result = await window.studio.saveCardWireframe({ projectId, cardId: card.id, expectedRevision: saved?.revision ?? 0, title: draft.title, elements: draft.elements, artboards: draft.artboards, interactions: draft.interactions });
      if (unsavedDrafts.get(key) === submittedDraft) unsavedDrafts.delete(key);
      if (generation.current !== currentGeneration) return;
      setSaved(result); setDraft({ title: result.title, elements: result.elements, artboards: result.artboards, interactions: result.interactions }); setDirty(false);
      setNotice(result.approvedRevision === result.revision ? 'Entwurf unverändert; Freigabe bleibt bestehen.' : 'Entwurf gespeichert. Für Agentenläufe ist eine eigene Freigabe nötig.');
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }
  async function approve() {
    if (!card || !saved || dirty || busy || interactionLocked.current) return;
    const currentGeneration = generation.current;
    interactionLocked.current = true;
    setBusy(true); setError('');
    try {
      const result = await window.studio.approveCardWireframe({ projectId, cardId: card.id, expectedRevision: saved.revision });
      if (generation.current !== currentGeneration) return;
      setSaved(result); setNotice('Version ' + result.revision + ' ist als Layoutkontext für künftige Agentenläufe freigegeben. Es wurde kein Agent gestartet.');
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }
  async function exportPng() {
    if (!card || !elements || busy || interactionLocked.current || !stage.current || inlineEditRef.current) return;
    const currentGeneration = generation.current;
    interactionLocked.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const dataUrl = await wireframePngDataUrl(stage.current, canvas.width, canvas.height);
      const result = await window.studio.exportWireframePng({ projectId, cardId: card.id, artboard, dataUrl });
      if (generation.current === currentGeneration && result) setNotice(`${canvas.label}-PNG gespeichert: ${result.file}`);
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }
  async function propose() {
    if (!card || dirty || busy || interactionLocked.current) return;
    const currentGeneration = generation.current;
    interactionLocked.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const proposal = await window.studio.proposeCardWireframe({ projectId, cardId: card.id });
      if (generation.current !== currentGeneration) return;
      if (draft) recordHistory(draft);
      retainDraft({ title: proposal.title, elements: proposal.elements, artboards: draft?.artboards ?? {}, interactions: [] }); setArtboard('desktop'); setSelectedId(null);
      setNotice('Agentenvorschlag geladen. Prüfe und bearbeite ihn, bevor du ihn speicherst und gesondert freigibst.');
    } catch (reason) { if (generation.current === currentGeneration) setError(messageOf(reason)); }
    finally { if (generation.current === currentGeneration) { interactionLocked.current = false; setBusy(false); } }
  }

  return <section className={`task-wireframe${focusMode ? ' is-focused' : ''}`} aria-label="Wireframe-Entwurf" onKeyDownCapture={(event) => { if (event.key !== 'Escape' || inlineEditRef.current || (event.target instanceof Element && event.target.closest('details.task-wireframe-menu[open]'))) return; if (drawing.current || drawTool) { event.preventDefault(); event.stopPropagation(); const wasDrawing = Boolean(drawing.current); cancelDrawing(); if (!wasDrawing) setDrawTool(null); return; } if (!enteredGroupId) return; if (marquee.current) { event.preventDefault(); event.stopPropagation(); cancelMarquee(); return; } event.preventDefault(); event.stopPropagation(); leaveGroup(); }}>
    <div className="task-wireframe-head"><div><h2>Wireframe zur Aufgabe</h2><p>Entwirf ein App-Fenster vor dem Coding. Nur eine ausdrücklich freigegebene gespeicherte Version geht als Layoutkontext an spätere Agentenläufe.</p></div><button type="button" className="secondary-button task-wireframe-focus-toggle" aria-pressed={focusMode} aria-disabled={focusPending || undefined} disabled={!focusMode && (!card || !canEnterFocus)} title={focusPending ? 'Ansicht wird gewechselt.' : !focusMode && !canEnterFocus ? 'Beende zuerst die laufende Design-Auswahl oder Vorschau-Aktion.' : undefined} onClick={() => { if (!focusPending) onFocusModeChange(!focusMode); }}>{focusMode ? 'Editor verkleinern' : 'Arbeitsfläche vergrößern'}</button></div>
    <div className="task-wireframe-source">
      <label>Aufgabe<select aria-label="Aufgabe für Wireframe auswählen" value={cardId} disabled={dirty || busy} onChange={(event) => { setLoading(Boolean(event.target.value)); setSaved(null); setDraft(null); if (event.target.value) lastSelectedCard.set(projectId, event.target.value); else lastSelectedCard.delete(projectId); setCardId(event.target.value); }}><option value="">Karte auswählen</option>{cards.map((item) => <option key={item.id} value={item.id}>{item.title}{item.archivedAt ? ' · archiviert' : ''}</option>)}</select></label>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {notice && notice !== 'Ungespeicherte Änderungen.' ? <p className="task-wireframe-notice" role="status">{notice}</p> : null}
    {!card ? <p className="task-wireframe-empty">Wähle eine Karte. Der Entwurf bleibt lokal beim Projekt und startet keinen Agenten.</p> : loading ? <p role="status">Entwurf wird geladen…</p> : !draft ? <div className="task-wireframe-start">
      <div className="task-wireframe-start-intro"><h3>Für „{card.title}“ gibt es noch keinen Wireframe.</h3><p>Beginne auf einer leeren Desktop-Zeichenfläche (960 × 600) oder nutze ein einfaches Fenstergerüst als Vorlage. Beide Wege bleiben bis zum Speichern lokal.</p></div>
      <div className="task-wireframe-start-actions" role="group" aria-label="Startpunkt für Wireframe">
        <button type="button" className="primary-button" disabled={busy} onClick={() => edit({ title: card.title.slice(0, 100), elements: [], artboards: {}, interactions: [] })}>Leere Fläche beginnen</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => edit(starterWireframe(card))}>Fenstergerüst vorbereiten</button>
      </div>
      <button type="button" className="task-wireframe-start-agent" disabled={busy} onClick={() => void propose()}>{busy ? 'Agent entwirft…' : 'Mit Agent vorschlagen'}</button>
      <small>Der Agentenvorschlag nutzt den gewählten Codex-Workflow-Agenten lesend und bleibt bis zum Speichern ein Entwurf.</small>
    </div> : <>
      {focusMode ? <WireframeArtboardOverview elements={draft.elements} artboards={draft.artboards} active={artboard} disabled={busy} onSelect={switchArtboard} />
        : <div className="task-wireframe-artboard-switch" role="group" aria-label="Wireframe-Zeichenfläche">{(Object.keys(WIREFRAME_ARTBOARDS) as WireframeArtboard[]).map((name) => <button key={name} type="button" className={artboard === name ? 'active' : ''} aria-pressed={artboard === name} disabled={busy} onClick={() => switchArtboard(name)}>{WIREFRAME_ARTBOARDS[name].label}<small>{WIREFRAME_ARTBOARDS[name].width} × {WIREFRAME_ARTBOARDS[name].height}{name !== 'desktop' && draft.artboards[name] === undefined ? ' · fehlt' : ''}</small></button>)}</div>}
      {artboard !== 'desktop' && elements === undefined ? <div className="task-wireframe-empty task-wireframe-variant-empty"><p>Für {canvas.label} gibt es noch keinen eigenen Entwurf. Desktop bleibt unverändert.</p><button type="button" className="secondary-button" disabled={busy} onClick={() => createArtboard(artboard, true)}>Desktop als Ausgangspunkt kopieren</button><button type="button" className="secondary-button" disabled={busy} onClick={() => createArtboard(artboard, false)}>Leere Zeichenfläche beginnen</button><small>Die Kopie passt nur Breiten an. Sie ist kein automatisch responsives Layout; prüfe die Anordnung selbst.</small></div> : null}
      {enteredGroupId ? <div className="task-wireframe-group-path" role="group" aria-label="Gruppenbearbeitung"><span>Gruppe · {elements?.filter((item) => item.groupId === enteredGroupId).length ?? 0} Elemente</span><span aria-hidden="true">›</span><strong>{selected ? `${labelForKind[selected.kind]} · ${selected.text || 'ohne Text'}` : 'Mitglied wählen'}</strong><button type="button" className="secondary-button small" onClick={leaveGroup}>Gruppe verlassen · Esc</button></div> : null}
      <div className="task-wireframe-toolbar">
        <div className="task-wireframe-toolset" role="group" aria-label="Zeichenwerkzeuge">
          <button type="button" className="task-wireframe-tool" aria-label="Auswählen" aria-pressed={!drawTool} title="Auswählen · Esc" onClick={() => { cancelMarquee(); cancelDrawing(); setDrawTool(null); }}><MousePointer2 size={16} aria-hidden="true" /></button>
          {(['panel', 'text', 'ellipse', 'line'] as const).map((kind) => <button key={kind} type="button" className="task-wireframe-tool" data-wireframe-draw-kind={kind} aria-label={`${labelForKind[kind]} ${kind === 'text' ? 'platzieren' : 'zeichnen'}`} aria-pressed={drawTool === kind} disabled={busy || !elements || elements.length >= 40 || Boolean(inlineItem)} onClick={() => { cancelMarquee(); cancelDrawing(); setDrawTool((current) => current === kind ? null : kind); }} title={kind === 'text' ? 'Text durch Klicken oder Ziehen platzieren · Esc beendet' : `${labelForKind[kind]} auf freiem Grund ziehen · Esc beendet`}>{kind === 'panel' ? <Square size={16} aria-hidden="true" /> : kind === 'text' ? <Type size={17} aria-hidden="true" /> : kind === 'ellipse' ? <Circle size={16} aria-hidden="true" /> : <Minus size={16} aria-hidden="true" />}</button>)}
        </div>
        <details name="wireframe-toolbar" className="task-wireframe-menu task-wireframe-add-menu" onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.preventDefault(); event.stopPropagation(); } }}>
          <summary aria-label="Element hinzufügen" aria-disabled={busy || !elements || elements.length >= 40} onClick={(event) => { if (busy || !elements || elements.length >= 40) event.preventDefault(); }}><Plus size={15} aria-hidden="true" /> Einfügen</summary>
          <div className="task-wireframe-menu-items" role="group" aria-label="Elementart wählen">
            {(['panel', 'text', 'button', 'field', 'ellipse', 'line'] as const).map((kind) => <button key={kind} type="button" disabled={busy || !elements || elements.length >= 40} onClick={(event) => { addElement(kind); const menu = event.currentTarget.closest('details'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } }}>{kind === 'ellipse' ? <Circle size={15} aria-hidden="true" /> : kind === 'line' ? <Minus size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{labelForKind[kind]}</button>)}
          </div>
        </details>
        <div className="task-wireframe-history" role="group" aria-label="Bearbeitungsschritte"><button type="button" className="secondary-button small" aria-label="Rückgängig" disabled={busy || !past.current.length} onClick={undo} title="Rückgängig"><Undo2 size={16} aria-hidden="true" /></button><button type="button" className="secondary-button small" aria-label="Wiederholen" disabled={busy || !future.current.length} onClick={redo} title="Wiederholen"><Redo2 size={16} aria-hidden="true" /></button></div>
        <details name="wireframe-toolbar" className="task-wireframe-menu task-wireframe-more-menu" onBlur={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.preventDefault(); event.stopPropagation(); } }}>
          <summary>Mehr <span aria-hidden="true">⌄</span></summary>
          <div className="task-wireframe-menu-items" role="group" aria-label="Weitere Aktionen">
            <button type="button" className="task-wireframe-export" disabled={busy || !elements || Boolean(inlineItem)} onClick={(event) => { const menu = event.currentTarget.closest('details'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } void exportPng(); }}><Download size={15} aria-hidden="true" />PNG exportieren</button>
            <button type="button" className="task-wireframe-propose" disabled={busy || dirty} onClick={(event) => { const menu = event.currentTarget.closest('details'); if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); } void propose(); }}>{busy ? 'Agent entwirft…' : 'Mit Agent neu vorschlagen'}</button>
          </div>
        </details>
      </div>
      <div className="task-wireframe-actions"><span role="status">{saved ? `Version ${saved.revision}${saved.approvedRevision === saved.revision ? ' · freigegeben' : ' · nicht freigegeben'}` : 'Noch nicht gespeichert'}{dirty ? ' · geändert' : ''}</span><button type="button" className="secondary-button" disabled={!dirty || busy || !draft.title.trim()} onClick={() => void save()}>{busy && dirty ? 'Speichere…' : 'Entwurf speichern'}</button><button type="button" className="primary-button" disabled={!saved || dirty || busy || !(saved.elements.length || Object.values(saved.artboards).some((items) => items.length)) || saved.approvedRevision === saved.revision} onClick={() => void approve()}><Check size={15} aria-hidden="true" />Für Agenten freigeben</button>{dirty ? <button type="button" className="secondary-button task-wireframe-discard" disabled={busy} onClick={() => { if (cardId) { unsavedDrafts.delete(draftKey(projectId, card.id)); void load(card.id); } }}>Änderungen verwerfen</button> : null}{saved && !dirty ? <button type="button" className="icon-button" disabled={busy} title="Gespeicherten Entwurf neu laden" aria-label="Gespeicherten Entwurf neu laden" onClick={() => void load(card.id)}><RotateCcw size={15} /></button> : null}</div>
      {elements ? <div className="task-wireframe-layout">
        <aside className="task-wireframe-layers" aria-label="Ebenen" onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAllInScope(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); if (!event.repeat) duplicateSelection(event.target as HTMLElement); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); if (!event.repeat) event.shiftKey ? ungroupSelection() : groupSelection(); } else if (event.key === 'F2') { const item = elements.find((candidate) => candidate.id === (event.target as HTMLElement).dataset.wireframeId); if (item && isTextEditable(item.kind)) { event.preventDefault(); startInlineTextEdit(item); } } else if (event.key === 'Escape') { event.preventDefault(); setSelectedId(null); } else if (event.key === 'Delete' && selectedIds.length) { event.preventDefault(); removeSelection(); } }}><h3>Ebenen</h3><p className="task-wireframe-selection-hint">Umschalt/Strg: Mehrfachauswahl · Strg+G: Gruppe · F2: Text</p>{elements.length ? <ol>{elements.map((item) => <li key={item.id}><button data-wireframe-id={item.id} type="button" disabled={busy} className={`${selectedIds.includes(item.id) ? 'selected' : ''}${enteredGroupId && item.groupId === enteredGroupId ? ' in-entered-group' : ''}`} aria-pressed={selectedIds.includes(item.id)} onClick={(event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) toggleSelected(item.id); else setSelectedId(item.id); }}>{item.groupId ? 'Gruppe · ' : ''}{labelForKind[item.kind]} · {item.text || 'Ohne Text'}</button></li>)}</ol> : <p>Noch keine Elemente.</p>}</aside>
        <div className="task-wireframe-canvas-wrap" data-artboard={artboard}>
          <div className="task-wireframe-canvas-head"><span>{canvas.width} × {canvas.height} · {canvas.label}{elements.length === 0 ? ' · leer' : ''}</span><div className="task-wireframe-view-controls" role="group" aria-label="Zeichenflächenansicht"><button type="button" className="secondary-button small" aria-label="Ansicht verkleinern" disabled={zoom <= 50} onClick={() => setZoom((value) => value - 25)}>−</button><output aria-label="Zoomstufe">{zoom} %</output><button type="button" className="secondary-button small" aria-label="Ansicht vergrößern" disabled={zoom >= 150} onClick={() => setZoom((value) => value + 25)}>+</button><button type="button" className="secondary-button small" aria-pressed={snapToGrid} onClick={() => setSnapToGrid((value) => !value)}>8 px Raster</button></div></div>
          <div ref={viewport} className={`task-wireframe-canvas-viewport${panReady ? ' pan-ready' : ''}${panning ? ' pan-active' : ''}`} role="region" tabIndex={0} aria-label="Verschiebbare Zeichenflächenansicht" onPointerDown={startPan} onPointerMove={movePan} onPointerUp={(event) => stopPan(event.pointerId)} onPointerCancel={(event) => stopPan(event.pointerId)} onLostPointerCapture={(event) => stopPan(event.pointerId)} onKeyDown={onCanvasKeyDown} onKeyUp={onCanvasKeyUp} onBlur={onCanvasBlur}><div className="task-wireframe-canvas-scale" style={{ width: `${zoom}%`, aspectRatio: `${canvas.width} / ${canvas.height}` }}><div className={`task-wireframe-canvas${snapToGrid ? ' has-grid' : ''}${drawTool ? ' draw-ready' : ''}`} style={{ aspectRatio: `${canvas.width} / ${canvas.height}`, width: `${10000 / zoom}%`, transform: `scale(${zoom / 100})`, backgroundSize: snapToGrid ? `${800 / canvas.width}% ${800 / canvas.height}%` : undefined }} ref={stage} role="group" tabIndex={0} aria-label={`Editierbares ${canvas.label}-Wireframe`} onPointerDown={startMarquee} onPointerMove={moveMarquee} onPointerUp={finishMarquee} onPointerCancel={() => { cancelMarquee(); cancelDrawing(); }} onLostPointerCapture={() => { cancelMarquee(); cancelDrawing(); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAllInScope(); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); if (!event.repeat) duplicateSelection(event.target as HTMLElement); } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); if (!event.repeat) event.shiftKey ? ungroupSelection() : groupSelection(); } else if (event.key === 'F2') { const item = elements.find((candidate) => candidate.id === (event.target as HTMLElement).dataset.wireframeId) ?? selected; if (item && isTextEditable(item.kind)) { event.preventDefault(); startInlineTextEdit(item); } } else if (event.key === 'Escape') { event.preventDefault(); if (marquee.current) cancelMarquee(); else setSelectedId(null); } }}>
          {elements.map((item) => <button data-wireframe-id={item.id} key={item.id} type="button" disabled={busy} className={`task-wireframe-element kind-${item.kind} tone-${item.tone}${selectedIds.includes(item.id) ? ' selected' : ''}${enteredGroupId && item.groupId === enteredGroupId ? ' in-entered-group' : ''}`} style={{ left: `${item.x / canvas.width * 100}%`, top: `${item.y / canvas.height * 100}%`, width: `${item.width / canvas.width * 100}%`, height: `${item.height / canvas.height * 100}%`, backgroundColor: item.kind === 'line' ? undefined : wireframeColorCss(item, 'fill'), borderColor: item.kind === 'line' ? undefined : wireframeColorCss(item, 'stroke'), color: item.kind === 'line' ? wireframeColorCss(item, 'stroke') ?? (item.tone === 'accent' ? 'var(--accent)' : 'var(--text)') : wireframeColorCss(item, 'textColor'), borderRadius: item.kind === 'ellipse' ? '50%' : item.style?.radius, fontSize: wireframePreviewFontSize(item.style?.fontSize, canvas.width), fontWeight: item.style?.fontWeight }} aria-label={`${labelForKind[item.kind]}${isShape(item.kind) ? '' : `: ${item.text || 'ohne Text'}`}`} aria-pressed={selectedIds.includes(item.id)}
            onFocus={() => { if (!interactionLocked.current && !pointerSelection.current && !spaceHeld.current && !selectedIds.includes(item.id)) setSelectedId(item.id); }}
            onDoubleClick={(event) => { if (event.shiftKey || event.ctrlKey || event.metaKey) return; event.preventDefault(); event.stopPropagation(); if (item.groupId && enteredGroupId !== item.groupId) enterGroup(item.groupId, item.id); else startInlineTextEdit(item); }}
            onPointerDown={(event) => { if (interactionLocked.current || event.button !== 0 || spaceHeld.current || inlineEditRef.current?.id === item.id) return; if (event.shiftKey || event.ctrlKey || event.metaKey) { event.preventDefault(); toggleSelected(item.id); return; } pointerSelection.current = true; const scopeGroupId = item.groupId === enteredGroupId ? enteredGroupId : null; if (enteredGroupId && !scopeGroupId) setEditingGroupId(null); const ids = selectedIds.includes(item.id) ? selectedIds : selectWireframeTarget(elements, item.id, scopeGroupId); if (ids !== selectedIds) setSelectedIds(ids); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: item.id, ids, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, before: draft, origin: elements, scopeGroupId, recorded: false }; }}
            onPointerMove={(event) => { const current = drag.current; const rect = stage.current?.getBoundingClientRect(); if (!current || current.id !== item.id || current.pointerId !== event.pointerId || !rect?.width || !rect.height) return; const rawDx = (event.clientX - current.clientX) * canvas.width / rect.width; const rawDy = (event.clientY - current.clientY) * canvas.height / rect.height; const origin = current.origin.find((candidate) => candidate.id === item.id)!; const dx = snapToGrid ? snapWireframePosition(origin.x + rawDx, origin.width, canvas.width) - origin.x : rawDx; const dy = snapToGrid ? snapWireframePosition(origin.y + rawDy, origin.height, canvas.height) - origin.y : rawDy; const next = moveWireframeSelection(current.origin, current.ids, dx, dy, canvas.width, canvas.height, current.scopeGroupId); if (next.some((candidate, index) => candidate.x !== elements[index]!.x || candidate.y !== elements[index]!.y)) { if (!current.recorded) { recordHistory(current.before); current.recorded = true; } editElements(next, false); } }}
            onPointerUp={(event) => { pointerSelection.current = false; if (drag.current?.pointerId === event.pointerId) drag.current = null; }} onPointerCancel={() => { pointerSelection.current = false; drag.current = null; }}
            onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; if (event.key === 'ArrowLeft') { event.preventDefault(); moveSelected(item, -step, 0); } else if (event.key === 'ArrowRight') { event.preventDefault(); moveSelected(item, step, 0); } else if (event.key === 'ArrowUp') { event.preventDefault(); moveSelected(item, 0, -step); } else if (event.key === 'ArrowDown') { event.preventDefault(); moveSelected(item, 0, step); } else if (event.key === 'Delete') { event.preventDefault(); selectedIds.includes(item.id) ? removeSelection() : removeElement(item.id); } }}>
            {item.kind === 'line' ? <svg className="task-wireframe-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line className="task-wireframe-line-hit" x1="2" y1={item.lineDirection === 'rising' ? '98' : '2'} x2="98" y2={item.lineDirection === 'rising' ? '2' : '98'} /><line className="task-wireframe-line-visible" x1="2" y1={item.lineDirection === 'rising' ? '98' : '2'} x2="98" y2={item.lineDirection === 'rising' ? '2' : '98'} /></svg> : item.kind === 'field' ? <span>{item.text || 'Eingabe'}</span> : item.text}
          </button>)}
          {marqueeView ? <div className="task-wireframe-marquee" aria-hidden="true" style={{ left: `${Math.min(marqueeView.start.x, marqueeView.end.x) / canvas.width * 100}%`, top: `${Math.min(marqueeView.start.y, marqueeView.end.y) / canvas.height * 100}%`, width: `${Math.abs(marqueeView.end.x - marqueeView.start.x) / canvas.width * 100}%`, height: `${Math.abs(marqueeView.end.y - marqueeView.start.y) / canvas.height * 100}%` }} /> : null}
          {drawPreview && drawingView ? <div className={`task-wireframe-drawing-preview kind-${drawingView.kind}`} aria-hidden="true" style={{ left: `${drawPreview.x / canvas.width * 100}%`, top: `${drawPreview.y / canvas.height * 100}%`, width: `${drawPreview.width / canvas.width * 100}%`, height: `${drawPreview.height / canvas.height * 100}%` }}>{drawingView.kind === 'line' ? <svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="2" y1={drawPreview.lineDirection === 'rising' ? '98' : '2'} x2="98" y2={drawPreview.lineDirection === 'rising' ? '2' : '98'} /></svg> : null}</div> : null}
          {inlineItem ? <input ref={inlineInput} className={`task-wireframe-inline-text kind-${inlineItem.kind} tone-${inlineItem.tone}`} data-wireframe-inline-editor={inlineItem.id} aria-label={`Text direkt bearbeiten: ${labelForKind[inlineItem.kind]}`} maxLength={120} value={inlineTextEdit?.text ?? ''} style={{ left: `${inlineItem.x / canvas.width * 100}%`, top: `${inlineItem.y / canvas.height * 100}%`, width: `${inlineItem.width / canvas.width * 100}%`, height: `${inlineItem.height / canvas.height * 100}%`, backgroundColor: wireframeColorCss(inlineItem, 'fill'), borderColor: wireframeColorCss(inlineItem, 'stroke'), color: wireframeColorCss(inlineItem, 'textColor'), borderRadius: inlineItem.style?.radius, fontSize: wireframePreviewFontSize(inlineItem.style?.fontSize, canvas.width), fontWeight: inlineItem.style?.fontWeight }} onChange={(event) => updateInlineTextEdit({ ...inlineTextEdit!, text: event.target.value.slice(0, 120) })} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); finishInlineTextEdit(true); } else if (event.key === 'Escape') { event.preventDefault(); finishInlineTextEdit(false); } }} onBlur={() => finishInlineTextEdit(true, false)} /> : null}
          {selected ? <button type="button" className="task-wireframe-resize" disabled={busy} style={{ left: `clamp(16px, ${(selected.x + selected.width) / canvas.width * 100}%, calc(100% - 16px))`, top: `clamp(16px, ${(selected.y + selected.height) / canvas.height * 100}%, calc(100% - 16px))` }} aria-label={`Größe ändern: ${labelForKind[selected.kind]} ${selected.text || 'ohne Text'}. Pfeil rechts oder links ändert Breite, Pfeil unten oder oben Höhe; Umschalt für zehn Pixel.`} title="Größe ziehen · Pfeiltasten ändern um 1 px, Umschalt um 10 px"
            onPointerDown={(event) => { if (interactionLocked.current || event.button !== 0 || spaceHeld.current || !draft) return; event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); resize.current = { id: selected.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, width: selected.width, height: selected.height, before: draft, recorded: false }; }}
            onPointerMove={(event) => { const current = resize.current; const rect = stage.current?.getBoundingClientRect(); if (!current || current.id !== selected.id || current.pointerId !== event.pointerId || !rect?.width || !rect.height) return; const next = resizeWireframeElement({ ...selected, width: current.width, height: current.height }, (event.clientX - current.clientX) * canvas.width / rect.width, (event.clientY - current.clientY) * canvas.height / rect.height, canvas.width, canvas.height); if (next.width !== selected.width || next.height !== selected.height) { if (!current.recorded) { recordHistory(current.before); current.recorded = true; } editElement(selected.id, { width: next.width, height: next.height }, false); } }}
            onPointerUp={(event) => { if (resize.current?.pointerId === event.pointerId) resize.current = null; }} onPointerCancel={() => { resize.current = null; }}
            onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; const change: [number, number] | null = event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowDown' ? [0, step] : event.key === 'ArrowUp' ? [0, -step] : null; if (!change) return; event.preventDefault(); event.stopPropagation(); const next = resizeWireframeElement(selected, change[0], change[1], canvas.width, canvas.height); editElement(selected.id, { width: next.width, height: next.height }); }}><CornerDownRight size={12} aria-hidden="true" /></button> : null}
        </div></div></div><p className="task-wireframe-canvas-hint"><MousePointer2 size={13} aria-hidden="true" /> Ziehen oder Pfeiltasten · Leertaste + Ziehen / mittlere Maustaste: Ansicht verschieben · Strg + Mausrad: Zoom · Doppelklick/F2: Text · Ecke: Größe</p></div>
        <aside className="task-wireframe-properties" aria-label="Eigenschaften"><h3>Eigenschaften</h3><label>Entwurfstitel<input value={draft.title} disabled={busy} maxLength={100} onChange={(event) => edit({ ...draft, title: event.target.value })} /></label>{selectedElements.length ? <button type="button" className="secondary-button small task-wireframe-duplicate" disabled={busy || elements.length + selectedElements.length > 40} onClick={() => duplicateSelection()} title="Auswahl duplizieren (Strg+D)"><Copy size={14} aria-hidden="true" />Auswahl duplizieren</button> : null}{selectedElements.length > 1 ? <div className="task-wireframe-multi" role="group" aria-label="Mehrfachauswahl ausrichten"><strong>{selectedElements.length} Elemente ausgewählt</strong>{selectedGroupId && !enteredGroupId ? <button type="button" className="secondary-button small" disabled={busy} onClick={() => enterGroup(selectedGroupId)}>Gruppe bearbeiten</button> : null}<div className="task-wireframe-group-actions"><button type="button" className="secondary-button small" disabled={busy || Boolean(selectedElements[0]?.groupId && selectedElements.every((item) => item.groupId === selectedElements[0]?.groupId))} onClick={groupSelection}>Gruppieren</button>{selectedElements.some((item) => item.groupId) ? <button type="button" className="secondary-button small" disabled={busy} onClick={ungroupSelection}>Gruppe lösen</button> : null}</div>{selectedElements.some((item) => item.groupId) ? <small>Zum Ausrichten zuerst die Gruppe lösen.</small> : null}<div className="task-wireframe-align-grid">{([
          ['left', 'Links'], ['center-x', 'Mitte X'], ['right', 'Rechts'], ['top', 'Oben'], ['center-y', 'Mitte Y'], ['bottom', 'Unten'],
        ] as const).map(([mode, label]) => <button key={mode} type="button" className="secondary-button small" disabled={busy || selectedElements.some((item) => item.groupId)} onClick={() => alignSelection(mode)}>{label}</button>)}</div><div className="task-wireframe-distribute"><button type="button" className="secondary-button small" disabled={busy || selectedElements.length < 3 || selectedElements.some((item) => item.groupId)} onClick={() => alignSelection('distribute-x')}>Horizontal verteilen</button><button type="button" className="secondary-button small" disabled={busy || selectedElements.length < 3 || selectedElements.some((item) => item.groupId)} onClick={() => alignSelection('distribute-y')}>Vertikal verteilen</button></div><button type="button" className="secondary-button small" disabled={busy} onClick={removeSelection}>Auswahl entfernen</button></div> : selected ? <>
          <div className="task-wireframe-property-kind">{labelForKind[selected.kind]}</div>
          {!isShape(selected.kind) ? <label>Text<input aria-label="Text des ausgewählten Elements" value={selected.text} disabled={busy} maxLength={120} onChange={(event) => editElement(selected.id, { text: event.target.value })} /></label> : null}
          {selected.kind === 'line' ? <label>Linienrichtung<select aria-label="Linienrichtung" value={selected.lineDirection ?? 'falling'} disabled={busy} onChange={(event) => editElement(selected.id, { lineDirection: event.target.value as 'falling' | 'rising' })}><option value="falling">Links oben nach rechts unten</option><option value="rising">Links unten nach rechts oben</option></select></label> : null}
          <div className="task-wireframe-geometry">{(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key}>{key === 'width' ? 'Breite' : key === 'height' ? 'Höhe' : key.toUpperCase()}<input type="number" min={key === 'width' || key === 'height' ? 24 : 0} max={key === 'width' || key === 'x' ? canvas.width : canvas.height} disabled={busy} value={geometryDraft?.id === selected.id && geometryDraft.key === key ? geometryDraft.raw : selected[key]} onChange={(event) => setGeometry(selected, key, event.target.value)} onBlur={() => setGeometryDraft(null)} /></label>)}</div>
          <label>Ton<select value={selected.tone} disabled={busy} onChange={(event) => editElement(selected.id, { tone: event.target.value as WireframeElementTone })}><option value="plain">Neutral</option><option value="muted">Zurückhaltend</option><option value="accent">Akzent</option></select></label>
          <fieldset className="task-wireframe-style"><legend>Gestaltung</legend>
            {!isShape(selected.kind) ? <><div className="task-wireframe-style-pair"><label>Schriftgröße<input aria-label="Schriftgröße in Pixel" type="number" min={8} max={64} step={1} placeholder="Standard" value={styleNumberDraft?.id === selected.id && styleNumberDraft.key === 'fontSize' ? styleNumberDraft.raw : selected.style?.fontSize ?? ''} disabled={busy} onChange={(event) => setStyleNumber(selected, 'fontSize', event.target.value)} onBlur={() => setStyleNumberDraft(null)} /></label><label>Schriftstärke<select aria-label="Schriftstärke" value={selected.style?.fontWeight ?? ''} disabled={busy} onChange={(event) => setStyle('fontWeight', event.target.value ? Number(event.target.value) : undefined)}><option value="">Standard</option><option value="400">Normal</option><option value="500">Mittel</option><option value="600">Halbfett</option><option value="700">Fett</option></select></label></div><StyleColorControl label="Textfarbe" styleKey="textColor" item={selected} disabled={busy} onChange={(value) => setStyle('textColor', value)} /></> : null}
            {selected.kind !== 'line' ? <StyleColorControl label="Füllung" styleKey="fill" item={selected} disabled={busy} onChange={(value) => setStyle('fill', value)} /> : null}
            <StyleColorControl label="Kontur" styleKey="stroke" item={selected} disabled={busy} onChange={(value) => setStyle('stroke', value)} />
            {!isShape(selected.kind) ? <label>Eckenradius<input aria-label="Eckenradius in Pixel" type="number" min={0} max={64} step={1} placeholder="Standard" value={styleNumberDraft?.id === selected.id && styleNumberDraft.key === 'radius' ? styleNumberDraft.raw : selected.style?.radius ?? ''} disabled={busy} onChange={(event) => setStyleNumber(selected, 'radius', event.target.value)} onBlur={() => setStyleNumberDraft(null)} /></label> : null}
          </fieldset>
          <div className="task-wireframe-layer-order" role="group" aria-label="Ebenenreihenfolge"><button type="button" className="secondary-button small" disabled={busy || elements[0]?.id === selected.id} onClick={() => changeLayer(selected.id, -1)}>Eine Ebene zurück</button><button type="button" className="secondary-button small" disabled={busy || elements[elements.length - 1]?.id === selected.id} onClick={() => changeLayer(selected.id, 1)}>Eine Ebene vor</button></div>
          <button type="button" className="secondary-button small" disabled={busy} onClick={() => removeElement(selected.id)}>Element entfernen</button>
        </> : <p>Wähle ein Element auf der Fläche oder in der Ebenenliste.</p>}</aside>
      </div> : null}
      {elements ? <WireframeComponentLibrary projectId={projectId} cardId={card.id} artboard={artboard} selection={selectedElements} availableSlots={40 - elements.length} disabled={busy} onInsert={insertComponent} /> : null}
      {artboard === 'desktop' ? <WireframeInteractionEditor elements={draft.elements} interactions={draft.interactions} disabled={busy} onChange={(interactions) => edit({ ...draft, interactions })} /> : null}
      {artboard !== 'desktop' && elements ? <div className="task-wireframe-variant-tools"><span>Eigener {canvas.label}-Entwurf</span><button type="button" className="secondary-button small" disabled={busy} onClick={() => removeArtboard(artboard)}>Zeichenfläche entfernen</button></div> : null}
      <p className="task-wireframe-help">Die Freigabe teilt nur die gespeicherte Anordnung beim nächsten Agentenstart. Kein Projektcode wird geändert. Nach einer Bearbeitung musst du erneut speichern und freigeben.</p>
    </>}
  </section>;
}
