import { describe, expect, it } from 'vitest';
import { repoMapOverview } from '../../src/renderer/repo-map-overview';
import type { RepoMapProposal } from '../../src/shared/repo-map';

const proposal: RepoMapProposal = {
  fingerprint: 'a'.repeat(64), source: 'git-index', trackedFileCount: 4, mappedFileCount: 4, truncated: false, warnings: [],
  nodes: [
    { id: 'folder:.', kind: 'folder', path: '.', title: 'Repository', x: 0, y: 0, evidence: { kind: 'tracked-path', path: 'README.md' } },
    { id: 'folder:src', kind: 'folder', path: 'src', title: 'src', x: 280, y: 0, evidence: { kind: 'tracked-path', path: 'src/main.ts' } },
    { id: 'folder:docs', kind: 'folder', path: 'docs', title: 'docs', x: 280, y: 120, evidence: { kind: 'tracked-path', path: 'docs/guide.md' } },
    { id: 'folder:src/ui', kind: 'package', path: 'src/ui', title: 'ui', x: 560, y: 0, evidence: { kind: 'package-manifest', path: 'src/ui/package.json' } },
  ],
  edges: [
    { sourceId: 'folder:.', targetId: 'folder:src', kind: 'contains', evidence: { kind: 'tracked-path', path: 'src/main.ts' } },
    { sourceId: 'folder:.', targetId: 'folder:docs', kind: 'contains', evidence: { kind: 'tracked-path', path: 'docs/guide.md' } },
    { sourceId: 'folder:src', targetId: 'folder:src/ui', kind: 'contains', evidence: { kind: 'package-manifest', path: 'src/ui/package.json' } },
  ],
};

describe('automatic repository overview', () => {
  it('keeps only connected, source-backed containment edges within the visible limit', () => {
    const overview = repoMapOverview(proposal, 3);
    expect(overview.nodes.map((node) => node.id)).toEqual(['folder:.', 'folder:docs', 'folder:src']);
    expect(overview.edges.map((edge) => `${edge.sourceId}>${edge.targetId}`)).toEqual(['folder:.>folder:src', 'folder:.>folder:docs']);
    expect(overview.omittedNodes).toBe(1);
    expect(overview.nodes.find((node) => node.id === 'folder:src')?.evidence.path).toBe('src/main.ts');
    expect(overview.nodes.map((node) => [node.x, node.y])).toEqual([[0, 0], [245, 0], [245, 108]]);
  });

  it('includes deeper package folders only when their parent is visible', () => {
    const overview = repoMapOverview(proposal, 4);
    expect(overview.nodes.map((node) => node.id)).toContain('folder:src/ui');
    expect(overview.edges).toHaveLength(3);
    expect(overview.omittedNodes).toBe(0);
  });

  it('rejects invalid limits and handles an empty tracked repository', () => {
    expect(() => repoMapOverview(proposal, 0)).toThrow('positive integer');
    expect(repoMapOverview({ ...proposal, nodes: [], edges: [] })).toEqual({ nodes: [], edges: [], omittedNodes: 0 });
  });
});
