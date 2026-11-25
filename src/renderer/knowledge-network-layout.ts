interface NetworkNode { id: string; width: number; height: number }
interface NetworkEdge { source: string; target: string }
interface Point { x: number; y: number }

/** A stable, bounded layout for already verified links. It never derives new edges. */
export function layoutKnowledgeNetwork(nodes: readonly NetworkNode[], edges: readonly NetworkEdge[]): Map<string, Point> {
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const orderedEdges = [...edges].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const points = ordered.map((node, index) => {
    const angle = index * 2.399963229728653;
    const radius = Math.sqrt(index) * 122;
    return { id: node.id, width: node.width, height: node.height, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  const indexById = new Map(points.map((node, index) => [node.id, index]));
  for (let step = 0; step < 110; step++) {
    const forces = points.map((node) => ({ x: -node.x * .0025, y: -node.y * .0025 }));
    for (let left = 0; left < points.length; left++) for (let right = left + 1; right < points.length; right++) {
      const dx = points[left]!.x - points[right]!.x;
      const dy = points[left]!.y - points[right]!.y;
      const distanceSquared = Math.max(400, dx * dx + dy * dy);
      const force = 2400 / distanceSquared;
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
      const pull = Math.max(-3, Math.min(3, (distance - 180) * .015));
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
