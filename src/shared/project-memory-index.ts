export type ProjectMemorySourceKind = 'task' | 'conversation' | 'commit' | 'code';

export interface ProjectMemoryIndexStatus {
  projectId: string;
  state: 'idle' | 'ready' | 'partial' | 'git-unavailable';
  indexedAt: string | null;
  gitRef: string | null;
  counts: Record<ProjectMemorySourceKind, number>;
  codeFilesSeen: number;
  codeFilesIndexed: number;
  warning: string | null;
}

export interface ProjectMemoryHit {
  kind: ProjectMemorySourceKind;
  sourceId: string;
  title: string;
  snippet: string;
  updatedAt: string;
  gitRef: string | null;
  path: string | null;
  cardId: string | null;
  sessionId: string | null;
}

export interface ProjectMemorySearch {
  status: ProjectMemoryIndexStatus;
  hits: ProjectMemoryHit[];
}

/** A bounded, provenance-preserving inventory for the relationship map. */
export interface ProjectMemoryMapSources {
  gitRef: string | null;
  headCommit: { sourceId: string; title: string; updatedAt: string } | null;
  codeFiles: Array<{ path: string; sourceId: string; updatedAt: string }>;
  totalCodeFiles: number;
}

export interface ProjectMemorySearchInput {
  projectId: string;
  query: string;
  kind?: ProjectMemorySourceKind | 'all';
}

export interface ProjectMemorySourceDetail {
  kind: 'task' | 'commit' | 'code';
  sourceId: string;
  title: string;
  body: string;
  updatedAt: string;
  gitRef: string | null;
  path: string | null;
}

export interface ProjectMemorySourceInput {
  projectId: string;
  kind: ProjectMemorySourceDetail['kind'];
  sourceId: string;
}
