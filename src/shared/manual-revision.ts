export interface ManualRevision {
  id: string;
  cardId: string;
  projectId: string;
  path: string;
  baseHead: string;
  targetBranch: string;
  targetHead: string;
  targetHash: string;
  capturedAt: string;
  appliedAt: string | null;
  appliedHash: string | null;
}

export interface ManualMergePreview {
  revision: ManualRevision;
  sourceHead: string;
  targetHead: string;
  base: string;
  manual: string;
  agent: string;
  combined: string;
  hasConflicts: boolean;
  staleReason: string | null;
  previewToken: string;
}
