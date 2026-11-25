import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../../shared/types';
import type { RunDependency } from '../../shared/parallel-runs';

interface TraceLine { id: string; path: string; labelX: number; labelY: number }
interface TraceLayout { lines: TraceLine[]; hidden: RunDependency[] }

function cardAtEvent(event: Event): string | null {
  const target = event.target;
  return target instanceof Element ? target.closest<HTMLElement>('.board-card-wrap[data-card-id]')?.dataset.cardId ?? null : null;
}

function cardIsVisible(element: HTMLElement): boolean {
  let bounds = element.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return false;
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (!/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) continue;
    const clip = parent.getBoundingClientRect();
    bounds = {
      ...bounds,
      left: Math.max(bounds.left, clip.left), right: Math.min(bounds.right, clip.right),
      top: Math.max(bounds.top, clip.top), bottom: Math.min(bounds.bottom, clip.bottom),
    } as DOMRect;
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return false;
  }
  return bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight;
}

function tracePath(source: DOMRect, target: DOMRect): string {
  if (source.left < target.left - 25) {
    const x1 = source.right; const x2 = target.left;
    const y1 = source.top + source.height / 2; const y2 = target.top + target.height / 2;
    const bend = Math.max(24, Math.abs(x2 - x1) * .45);
    return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2 - 4} ${y2}`;
  }
  const x1 = source.left; const x2 = target.left;
  const y1 = source.top + source.height / 2; const y2 = target.top + target.height / 2;
  const gutter = Math.max(8, Math.min(x1, x2) - 28);
  return `M ${x1} ${y1} C ${gutter} ${y1}, ${gutter} ${y2}, ${x2 - 4} ${y2}`;
}

export function BoardDependencyTrace({ projectId, cards, onOpenCard }: { projectId: string; cards: Card[]; onOpenCard: (id: string) => void }) {
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<RunDependency[]>([]);
  const [dependencyIndex, setDependencyIndex] = useState(0);
  const [layout, setLayout] = useState<TraceLayout>({ lines: [], hidden: [] });
  const selectedDependency = dependencies[dependencyIndex] ?? null;

  useEffect(() => {
    const board = document.querySelector('.board-page');
    if (!board) return;
    const show = (event: Event) => setFocusedCardId(cardAtEvent(event));
    const leave = (event: Event) => {
      const next = (event as MouseEvent).relatedTarget;
      if (next instanceof Element && next.closest('.board-card-wrap[data-card-id]')?.getAttribute('data-card-id') === cardAtEvent(event)) return;
      setFocusedCardId(next instanceof Element ? next.closest<HTMLElement>('.board-card-wrap[data-card-id]')?.dataset.cardId ?? null : null);
    };
    board.addEventListener('pointerover', show);
    board.addEventListener('pointerout', leave);
    board.addEventListener('focusin', show);
    board.addEventListener('focusout', leave);
    return () => {
      board.removeEventListener('pointerover', show);
      board.removeEventListener('pointerout', leave);
      board.removeEventListener('focusin', show);
      board.removeEventListener('focusout', leave);
    };
  }, [projectId]);

  useEffect(() => {
    let current = true;
    setDependencies([]);
    setDependencyIndex(0);
    if (focusedCardId && cards.some((card) => card.id === focusedCardId)) {
      void window.studio.cardRunGate(focusedCardId).then((gate) => {
        if (current && gate.projectId === projectId && gate.cardId === focusedCardId) setDependencies(gate.dependencies.filter((dependency) => dependency.status !== 'approved'));
      }).catch(() => { if (current) setDependencies([]); });
    }
    return () => { current = false; };
  }, [focusedCardId, projectId, cards]);

  useEffect(() => {
    if (!focusedCardId || !selectedDependency) { setLayout({ lines: [], hidden: [] }); return; }
    const target = document.getElementById(`board-card-${focusedCardId}`);
    if (!target) return;
    const update = () => {
      const targetBounds = target.getBoundingClientRect();
      const lines: TraceLine[] = [];
      const hidden: RunDependency[] = [];
      for (const dependency of [selectedDependency]) {
        const source = document.getElementById(`board-card-${dependency.prerequisiteCardId}`);
        if (!(source instanceof HTMLElement) || !cardIsVisible(source)) { hidden.push(dependency); continue; }
        const sourceBounds = source.getBoundingClientRect();
        lines.push({
          id: dependency.prerequisiteCardId,
          path: tracePath(sourceBounds, targetBounds),
          labelX: Math.max(30, Math.min(sourceBounds.left, targetBounds.left) - 25),
          labelY: (sourceBounds.top + sourceBounds.height / 2 + targetBounds.top + targetBounds.height / 2) / 2,
        });
      }
      setLayout({ lines, hidden });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [focusedCardId, selectedDependency, cards]);

  useEffect(() => {
    const source = selectedDependency ? document.getElementById(`board-card-${selectedDependency.prerequisiteCardId}`) : null;
    source?.classList.add('dependency-source');
    return () => source?.classList.remove('dependency-source');
  }, [selectedDependency, cards]);

  const targetWrap = focusedCardId ? document.querySelector<HTMLElement>('.board-card-wrap[data-card-id="' + focusedCardId + '"]') : null;
  return <>
    {layout.lines.length ? createPortal(<svg className="board-dependency-overlay" aria-hidden="true" width="100%" height="100%">
      <defs><marker id="board-dependency-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
      {layout.lines.map((line) => <g key={line.id}><path className="board-dependency-line" d={line.path} markerEnd="url(#board-dependency-arrow)" /><text x={line.labelX} y={line.labelY} className="board-dependency-label">vorher</text></g>)}
    </svg>, document.body) : null}
    {targetWrap && layout.hidden.length ? createPortal(<div className="board-dependency-hidden" role="note"><span>Vorher nötig:</span>{layout.hidden.map((dependency) => <button key={dependency.prerequisiteCardId} type="button" onClick={() => onOpenCard(dependency.prerequisiteCardId)}>{dependency.prerequisiteTitle} ↗</button>)}</div>, targetWrap) : null}
    {targetWrap && dependencies.length > 1 ? createPortal(<div className="board-dependency-nav" role="group" aria-label="Vorgängerkarte auswählen"><span>Vorgänger {dependencyIndex + 1} von {dependencies.length}</span><button type="button" aria-label="Vorherigen Vorgänger zeigen" onClick={() => setDependencyIndex((index) => (index - 1 + dependencies.length) % dependencies.length)}>‹</button><button type="button" aria-label="Nächsten Vorgänger zeigen" onClick={() => setDependencyIndex((index) => (index + 1) % dependencies.length)}>›</button></div>, targetWrap) : null}
  </>;
}
