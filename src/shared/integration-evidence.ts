export type IntegrationTestState = 'running' | 'passed' | 'failed' | 'interrupted' | 'stale';

export interface IntegrationTestEvidence {
  id: number;
  cardId: string;
  sourceHead: string;
  targetHead: string;
  cardFingerprint: string;
  scriptName: string;
  scriptHash: string;
  state: IntegrationTestState;
  exitCode: number | null;
  outputTail: string;
  startedAt: string;
  endedAt: string | null;
  current: boolean;
}

export interface IntegrationReviewEvidence {
  cardId: string;
  sourceHead: string;
  targetHead: string;
  cardFingerprint: string;
  reviewedAt: string;
  current: boolean;
}

export interface IntegrationEvidence {
  configuredScript: string | null;
  test: IntegrationTestEvidence | null;
  review: IntegrationReviewEvidence | null;
}
