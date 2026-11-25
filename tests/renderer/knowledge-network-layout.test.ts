import { describe, expect, it } from 'vitest';
import { layoutKnowledgeNetwork } from '../../src/renderer/knowledge-network-layout';

const nodes = [
  { id: 'task:a', width: 174, height: 42 },
  { id: 'task:b', width: 174, height: 42 },
  { id: 'task:c', width: 174, height: 42 },
  { id: 'run:a', width: 146, height: 42 },
  { id: 'run:b', width: 146, height: 42 },
  { id: 'source:shared', width: 146, height: 42 },
  { id: 'commit:head', width: 146, height: 42 },
];
const edges = [
  { source: 'task:a', target: 'run:a' },
  { source: 'task:b', target: 'run:b' },
  { source: 'task:a', target: 'source:shared' },
  { source: 'task:b', target: 'source:shared' },
  { source: 'commit:head', target: 'source:shared' },
];

describe('source-backed network arrangement', () => {
  it('is stable across input ordering and leaves room for every compact label', () => {
    const layout = layoutKnowledgeNetwork(nodes, edges);
    expect([...layout]).toEqual([...layoutKnowledgeNetwork([...nodes].reverse(), [...edges].reverse())]);
    for (const node of nodes) {
      const position = layout.get(node.id);
      expect(position).toBeDefined();
      expect(position!.x).toBeGreaterThanOrEqual(0);
      expect(position!.y).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(position!.x + position!.y)).toBe(true);
    }
    for (let left = 0; left < nodes.length; left++) for (let right = left + 1; right < nodes.length; right++) {
      const a = nodes[left]!; const b = nodes[right]!;
      const aAt = layout.get(a.id)!; const bAt = layout.get(b.id)!;
      const separated = aAt.x + a.width + 8 <= bAt.x || bAt.x + b.width + 8 <= aAt.x
        || aAt.y + a.height + 6 <= bAt.y || bAt.y + b.height + 6 <= aAt.y;
      expect(separated, `${a.id} and ${b.id} overlap`).toBe(true);
    }
  });

  it('positions an empty graph without inventing nodes', () => {
    expect([...layoutKnowledgeNetwork([], edges)]).toEqual([]);
  });

  it('keeps a full bounded map of 28 nodes legible', () => {
    const many = Array.from({ length: 28 }, (_, index) => ({ id: `node:${index.toString().padStart(2, '0')}`, width: index % 4 === 0 ? 174 : 146, height: 42 }));
    const links = many.slice(1).map((node, index) => ({ source: many[Math.floor(index / 3)]!.id, target: node.id }));
    const layout = layoutKnowledgeNetwork(many, links);
    expect(layout.size).toBe(28);
    for (let left = 0; left < many.length; left++) for (let right = left + 1; right < many.length; right++) {
      const a = many[left]!; const b = many[right]!;
      const aAt = layout.get(a.id)!; const bAt = layout.get(b.id)!;
      expect(aAt.x + a.width + 4 <= bAt.x || bAt.x + b.width + 4 <= aAt.x
        || aAt.y + a.height + 4 <= bAt.y || bAt.y + b.height + 4 <= aAt.y,
      `${a.id} and ${b.id} overlap`).toBe(true);
    }
  });
});
