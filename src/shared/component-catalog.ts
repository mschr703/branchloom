export interface ComponentCandidate {
  name: string;
  path: string;
  line: number;
  kind: 'function' | 'const';
  sourceFingerprint: string;
}

export interface ComponentCatalog {
  source: 'git-index';
  scannedFiles: number;
  candidates: ComponentCandidate[];
  partial: boolean;
  notes: string[];
}
