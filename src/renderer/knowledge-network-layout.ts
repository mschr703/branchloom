interface NetworkNode { id: string; width: number; height: number }
interface NetworkEdge { source: string; target: string }
interface Point { x: number; y: number }

/** Prefer a source with saved links over an isolated newest task. */
export function defaultKnowledgeFocus(nodes: readonly Pick<NetworkNode, 'id'>[], edges: readonly NetworkEdge[], prefix: string): string {
  const candidates = nodes.filter((node) => node.id.startsWith(prefix));
  const pool = candidates.length ? candidates : nodes;
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return pool.reduce((best, node) => (degree.get(node.id) ?? 0) > (degree.get(best?.id ?? '') ?? 0) ? node : best, pool[0])?.id ?? '';
}

/** Focus one task and a directly connected run on narrow canvases. */
export function initialKnowledgeNetworkViewport(nodes: readonly (NetworkNode & Point)[], edges: readonly NetworkEdge[], canvasWidth: number, rootId?: string) {
  const focus = nodes.find((node) => node.id === rootId) ?? nodes.find((node) => node.id.startsWith('task:')) ?? nodes[0];
  if (!focus) return { x: 18, y: 12, zoom: 1 };
  const peers = edges.filter((edge) => edge.source === focus.id || edge.target === focus.id)
    .map((edge) => nodes.find((node) => node.id === (edge.source === focus.id ? edge.target : edge.source)))
    .filter((node): node is NetworkNode & Point => Boolean(node));
  const peer = peers.sort((a, b) => (b.x + b.width) - (a.x + a.width) || a.y - b.y)[0];
  const cluster = peer ? [focus, peer] : [focus];
  const left = Math.min(...cluster.map((node) => node.x));
  const right = Math.max(...cluster.map((node) => node.x + node.width));
  const top = Math.min(...cluster.map((node) => node.y));
  const zoom = Math.min(1, (canvasWidth - 24) / (right - left));
  return {
    x: Math.round((canvasWidth - (right - left) * zoom) / 2 - left * zoom),
    y: Math.round(85 - top * zoom),
    zoom,
  };
}

/** A local, source-backed neighborhood. Positions encode hop count, not semantic similarity. */
export function knowledgeNeighborhood(nodes: readonly NetworkNode[], edges: readonly NetworkEdge[], rootId: string, depth: 1 | 2) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!nodeIds.has(rootId)) return { ids: new Set<string>(), positions: new Map<string, Point>(), edges: [] as NetworkEdge[] };
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    neighbors.get(edge.source)!.add(edge.target);
    neighbors.get(edge.target)!.add(edge.source);
  }
  const levels = new Map([[rootId, 0]]);
  let frontier = [rootId];
  for (let step = 1; step <= depth; step++) {
    const next = [...new Set(frontier.flatMap((id) => [...(neighbors.get(id) ?? [])]))]
      .filter((id) => !levels.has(id)).sort();
    for (const id of next) levels.set(id, step);
    frontier = next;
  }
  const positions = new Map<string, Point>();
  const direct = [...levels].filter(([, level]) => level === 1).map(([id]) => id);
  const second = [...levels].filter(([, level]) => level === 2).map(([id]) => id)
    .sort((a, b) => {
      const parent = (id: string) => Math.min(...[...(neighbors.get(id) ?? [])].filter((peer) => levels.get(peer) === 1).map((peer) => direct.indexOf(peer)));
      return parent(a) - parent(b) || a.localeCompare(b);
    });
  positions.set(rootId, { x: 24, y: 38 + (Math.max(1, direct.length) - 1) * 41 });
  direct.forEach((id, index) => positions.set(id, { x: 310, y: 38 + index * 82 }));
  second.forEach((id, index) => positions.set(id, { x: 596, y: 38 + index * 82 }));
  return { ids: new Set(levels.keys()), positions, edges: edges.filter((edge) => levels.has(edge.source) && levels.has(edge.target)) };
}

/** A stable, bounded layout for already verified links. It never derives new edges. */
export function layoutKnowledgeNetwork(nodes: readonly NetworkNode[], edges: readonly NetworkEdge[]): Map<string, Point> {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const orderedEdges = [...edges].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const points = ordered.map((node, index) => {
    const angle = index * 2.399963229728653;
    const radius = Math.sqrt(index) * 76;
    return { id: node.id, width: node.width, height: node.height, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const indexById = new Map(points.map((node, index) => [node.id, index]));
  for (let step = 0; step < 80; step++) {
    const forces = points.map((node) => ({ x: -node.x * .012, y: -node.y * .012 }));
    for (let left = 0; left < points.length; left++) for (let right = left + 1; right < points.length; right++) {
      const dx = points[left]!.x - points[right]!.x;
      const dy = points[left]!.y - points[right]!.y;
      const distanceSquared = Math.max(400, dx * dx + dy * dy);
      const force = 150 / distanceSquared;
      forces[left]!.x += dx * force;
      forces[left]!.y += dy * force;
      forces[right]!.x -= dx * force;
      forces[right]!.y -= dy * force;
    }
    for (const edge of orderedEdges) {
      const from = indexById.get(edge.source);
      const to = indexById.get(edge.target);
      if (from === undefined || to === undefined || from === to) continue;
      const dx = points[to]!.x - points[from]!.x;
      const dy = points[to]!.y - points[from]!.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = Math.max(-2, Math.min(2, (distance - 155) * .018));
      forces[from]!.x += dx / distance * pull;
      forces[from]!.y += dy / distance * pull;
      forces[to]!.x -= dx / distance * pull;
      forces[to]!.y -= dy / distance * pull;
    }
    for (let index = 0; index < points.length; index++) {
      points[index]!.x += Math.max(-8, Math.min(8, forces[index]!.x));
      points[index]!.y += Math.max(-8, Math.min(8, forces[index]!.y));
    }
  }
  // Rectangular labels need room even if their connected centers are close.
  for (let step = 0; step < 40; step++) {
    let moved = false;
    for (let left = 0; left < points.length; left++) for (let right = left + 1; right < points.length; right++) {
      const a = points[left]!;
      const b = points[right]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const overlapX = (a.width + b.width) / 2 + 18 - Math.abs(dx);
      const overlapY = (a.height + b.height) / 2 + 14 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      moved = true;
      if (overlapX <= overlapY) {
        const shift = (overlapX + .1) / 2 * (dx < 0 ? -1 : 1);
        a.x -= shift; b.x += shift;
      } else {
        const shift = (overlapY + .1) / 2 * (dy < 0 ? -1 : 1);
        a.y -= shift; b.y += shift;
      }
    }
    if (!moved) break;
  }
  const minX = Math.min(0, ...points.map((point) => point.x - point.width / 2));
  const minY = Math.min(0, ...points.map((point) => point.y - point.height / 2));
  return new Map(points.map((point) => [point.id, {
    x: Math.round(point.x - point.width / 2 - minX + 30),
    y: Math.round(point.y - point.height / 2 - minY + 30),
  }]));
}
