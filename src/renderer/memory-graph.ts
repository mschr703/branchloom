import type { MemoryNote } from '../shared/types';

export interface GraphNode { id: string; title: string; x: number; y: number }
export interface GraphEdge { from: string; to: string }

export interface GraphScope { notes: MemoryNote[]; edges: GraphEdge[]; hiddenCount: number; focused: boolean }

/** Show only stored notes and real references. The focused scope never invents a link. */
export function graphScope(notes: readonly MemoryNote[], selectedId: string | null, mode: 'focus' | 'all'): GraphScope {
  const allEdges = noteEdges(notes);
  const selected = mode === 'focus' ? notes.find((note) => note.id === selectedId) : undefined;
  const connected = selected
    ? new Set([selected.id, ...allEdges.filter((edge) => edge.from === selected.id || edge.to === selected.id).flatMap((edge) => [edge.from, edge.to])])
    : null;
  const candidates = selected && connected
    ? [selected, ...notes.filter((note) => note.id !== selected.id && connected.has(note.id))]
    : [...notes];
  const scoped = candidates.slice(0, selected ? 24 : 50);
  const ids = new Set(scoped.map((note) => note.id));
  return {
    notes: scoped,
    edges: allEdges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)),
    hiddenCount: candidates.length - scoped.length,
    focused: Boolean(selected),
  };
}

/** Center the selected note; place direct neighbours in two legible rings. */
export function layoutFocusedNotes(notes: readonly MemoryNote[], width = 640, height = 400): GraphNode[] {
  if (!notes.length) return [];
  const centerX = width / 2;
  const centerY = height / 2;
  return notes.map((note, index) => {
    if (index === 0) return { id: note.id, title: note.title, x: centerX, y: centerY };
    const ring = index <= 10 ? 0 : 1;
    const ringIndex = ring === 0 ? index - 1 : index - 11;
    const ringCount = ring === 0 ? Math.min(notes.length - 1, 10) : notes.length - 11;
    const angle = -Math.PI / 2 + (ringIndex / Math.max(ringCount, 1)) * Math.PI * 2 + (ring ? .16 : 0);
    const radius = ring ? 165 : 103;
    return { id: note.id, title: note.title, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
}

/** Deterministic force layout: actual links pull together; other nodes make room. */
export function layoutNetworkNotes(notes: readonly MemoryNote[], edges: readonly GraphEdge[], width = 640, height = 400): GraphNode[] {
  const points = layoutNotes(notes, width, height).map((node) => ({ ...node }));
  if (points.length < 3) return points;
  const indexById = new Map(points.map((node, index) => [node.id, index]));
  for (let step = 0; step < 75; step++) {
    const forces = points.map((point) => ({ x: (width / 2 - point.x) * .004, y: (height / 2 - point.y) * .004 }));
    for (let left = 0; left < points.length; left++) for (let right = left + 1; right < points.length; right++) {
      const dx = points[left]!.x - points[right]!.x;
      const dy = points[left]!.y - points[right]!.y;
      const distanceSquared = Math.max(64, dx * dx + dy * dy);
      const force = 1500 / distanceSquared;
      forces[left]!.x += dx * force; forces[left]!.y += dy * force;
      forces[right]!.x -= dx * force; forces[right]!.y -= dy * force;
    }
    for (const edge of edges) {
      const from = indexById.get(edge.from); const to = indexById.get(edge.to);
      if (from === undefined || to === undefined) continue;
      const dx = points[to]!.x - points[from]!.x;
      const dy = points[to]!.y - points[from]!.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - 78) * .025;
      forces[from]!.x += dx / distance * force; forces[from]!.y += dy / distance * force;
      forces[to]!.x -= dx / distance * force; forces[to]!.y -= dy / distance * force;
    }
    for (let index = 0; index < points.length; index++) {
      points[index]!.x = Math.max(45, Math.min(width - 45, points[index]!.x + Math.max(-5, Math.min(5, forces[index]!.x))));
      points[index]!.y = Math.max(45, Math.min(height - 45, points[index]!.y + Math.max(-5, Math.min(5, forces[index]!.y))));
    }
  }
  return points;
}

/** Resolve stored ids and [[title]] references without guessing missing notes. */
export function noteEdges(notes: readonly MemoryNote[]): GraphEdge[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const byTitle = new Map(notes.map((note) => [note.title.trim().toLocaleLowerCase(), note.id]));
  const edges = new Set<string>();
  for (const note of notes) {
    const targets = new Set(note.links);
    for (const match of note.body.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const id = byTitle.get(match[1]!.trim().toLocaleLowerCase());
      if (id) targets.add(id);
    }
    for (const target of targets) {
      if (target !== note.id && byId.has(target)) edges.add(`${note.id}\u0000${target}`);
    }
  }
  return [...edges].map((entry) => {
    const [from, to] = entry.split('\u0000');
    return { from: from!, to: to! };
  });
}

/** Stable layout gives the graph a useful shape without a heavy graph package. */
export function layoutNotes(notes: readonly MemoryNote[], width = 640, height = 400): GraphNode[] {
  const centerX = width / 2;
  const centerY = height / 2;
  if (notes.length === 1) return [{ id: notes[0]!.id, title: notes[0]!.title, x: centerX, y: centerY }];
  const radius = Math.max(72, Math.min(width, height) * 0.35);
  return notes.map((note, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(notes.length, 1)) * Math.PI * 2;
    return { id: note.id, title: note.title, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
  });
}

export function backlinks(notes: readonly MemoryNote[], targetId: string): MemoryNote[] {
  const sourceIds = new Set(noteEdges(notes).filter((edge) => edge.to === targetId).map((edge) => edge.from));
  return notes.filter((note) => sourceIds.has(note.id));
}

export function linkedIdsForBody(body: string, notes: readonly MemoryNote[]): string[] {
  const byTitle = new Map(notes.map((note) => [note.title.trim().toLocaleLowerCase(), note.id]));
  const ids = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const id = byTitle.get(match[1]!.trim().toLocaleLowerCase());
    if (id) ids.add(id);
  }
  return [...ids];
}
