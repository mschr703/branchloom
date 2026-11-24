export interface RunDependency {
  prerequisiteCardId: string;
  prerequisiteTitle: string;
  source: 'split' | 'manual';
  status: 'blocked' | 'workflow' | 'approved';
  approvalNote: string | null;
  reports: Array<{ id: string; endedAt: string }>;
}

export interface CardRunGate {
  cardId: string;
  projectId: string;
  capacity: number;
  runningCount: number;
  running: Array<{ cardId: string; title: string; sessionId: string; worktreePath: string | null }>;
  dependency: RunDependency | null;
  dependencies: RunDependency[];
  blockers: string[];
  canStart: boolean;
}

export interface ReserveCardSessionInput {
  cardId: string;
  agentId: string;
  worktreePath?: string | null;
  codexThreadId?: string | null;
}
