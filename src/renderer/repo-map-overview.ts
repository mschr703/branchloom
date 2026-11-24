import type { RepoMapEdge, RepoMapNode, RepoMapProposal } from '../shared/repo-map';

export interface RepoMapOverview {
  nodes: RepoMapNode[];
  edges: RepoMapEdge[];
  omittedNodes: number;
}

/** A small, connected overview of the proposal; every displayed edge has a source path. */
export function repoMapOverview(proposal: RepoMapProposal, limit = 6): RepoMapOverview {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Overview limit must be a positive integer.');
  const byId = new Map(proposal.nodes.map((node) => [node.id, node]));
  const children = new Map<string, RepoMapEdge[]>();
  for (const edge of proposal.edges) {
    if (edge.kind !== 'contains' || !byId.has(edge.sourceId) || !byId.has(edge.targetId)) continue;
    const list = children.get(edge.sourceId) ?? [];
    list.push(edge);
    children.set(edge.sourceId, list);
  }
  const roots = proposal.nodes.filter((node) => !proposal.edges.some((edge) => edge.targetId === node.id));
  const queue = roots.map((node) => ({ node, depth: 0 }));
  const found: Array<{ node: RepoMapNode; depth: number }> = [];
  const seen = new Set<string>();
  while (queue.length && found.length < limit) {
    const { node, depth } = queue.shift()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    found.push({ node, depth });
    const next = children.get(node.id) ?? [];
    next.sort((a, b) => {
      const kind = (value: RepoMapEdge) => byId.get(value.targetId)?.kind === 'package' ? 0 : byId.get(value.targetId)?.kind === 'folder' ? 1 : 2;
      return kind(a) - kind(b) || (byId.get(a.targetId)?.path ?? '').localeCompare(byId.get(b.targetId)?.path ?? '');
    });
    for (const edge of next) queue.push({ node: byId.get(edge.targetId)!, depth: depth + 1 });
  }
  const rankByDepth = new Map<number, number>();
  const nodes = found.map(({ node, depth }) => {
    const rank = rankByDepth.get(depth) ?? 0;
    rankByDepth.set(depth, rank + 1);
    return { ...node, x: depth * 245, y: rank * 108 };
  });
  const ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: proposal.edges.filter((edge) => edge.kind === 'contains' && ids.has(edge.sourceId) && ids.has(edge.targetId)),
    omittedNodes: Math.max(0, proposal.nodes.length - nodes.length) };
}
