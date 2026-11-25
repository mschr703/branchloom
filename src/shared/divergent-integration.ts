export interface DivergentIntegration {
  cardId: string;
  path: string;
  branch: string;
  originalSourceHead: string;
  targetHead: string;
  resultHead: string | null;
  conflicts: string[];
  state: 'merging' | 'ready' | 'integrated' | 'stale' | 'missing';
  reason: string | null;
}
