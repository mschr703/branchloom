export type ApiFieldType = 'string' | 'number' | 'boolean';
export interface ApiContractField { name: string; type: ApiFieldType; required: boolean }
export interface ApiContractDraft {
  method: 'GET';
  path: string;
  response: 'object' | 'array';
  fields: ApiContractField[];
  error: { status: number; code: string; message: string };
}
export interface ApiContractPreview {
  draft: ApiContractDraft;
  fingerprint: string;
  expectedLatestRevision: number;
  example: unknown;
  errorExample: { error: { code: string; message: string } };
}
export interface ApiContractVersion extends ApiContractPreview {
  projectId: string;
  revision: number;
  createdAt: string;
}
export interface ApiContractCardBinding {
  cardId: string;
  revision: number;
  fingerprint: string;
  current: boolean;
  boundAt: string;
}
export interface ApiContractOverview {
  versions: ApiContractVersion[];
  bindings: ApiContractCardBinding[];
  cardRevisions: Record<string, number>;
}
export interface ApiContractMismatch { path: string; expected: string; actual: string }
export interface ApiContractCheck {
  revision: number;
  fingerprint: string;
  current: boolean;
  valid: boolean;
  mismatches: ApiContractMismatch[];
}
