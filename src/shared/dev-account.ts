export interface DevAccount {
  id: string;
  projectId: string;
  service: string;
  environment: string;
  role: string;
  subject: string;
  probePath: string;
  createdAt: string;
}

export interface DevAccountAssignment {
  cardId: string;
  accountId: string;
  assignedAt: string;
}

export interface DevAccountOverview {
  accounts: DevAccount[];
  assignment: DevAccountAssignment | null;
  cardRevision: number;
}

export interface CreateDevAccount {
  projectId: string;
  service: string;
  environment: string;
  role: string;
  subject: string;
  probePath: string;
}

export type DevAccountProbeState = 'verified' | 'login-required' | 'access-denied' | 'wrong-account' | 'unavailable';

export interface DevAccountProbe {
  accountId: string;
  cardId: string;
  origin: string;
  state: DevAccountProbeState;
  checkedAt: string;
  detail: string;
}

export interface DevAccountSeedConfig {
  projectId: string;
  service: string;
  environment: string;
  path: string;
  revision: string;
}

export interface DevAccountSeedAttempt {
  id: string;
  projectId: string;
  cardId: string;
  provisionerId: string;
  targetId: string;
  state: 'requested' | 'created' | 'already-exists' | 'denied' | 'unknown';
  at: string;
}

export interface DevAccountSeedCheck {
  id: string | null;
  targetId: string;
  state: 'missing' | 'exists' | 'login-required' | 'access-denied' | 'wrong-account' | 'unavailable';
  checkedAt: string;
}
