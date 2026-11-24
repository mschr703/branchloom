export interface DevEnvironmentProfile {
  projectId: string;
  executable: string;
  args: string[];
  healthPath: string;
  healthMarker: string;
  updatedAt: string;
}

export type DevEnvironmentState = 'starting' | 'ready' | 'failed' | 'stopped' | 'interrupted';

export interface CardDevEnvironment {
  id: string;
  projectId: string;
  cardId: string;
  worktreePath: string;
  branch: string;
  port: number;
  url: string;
  state: DevEnvironmentState;
  startedAt: string;
  readyAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  output: string;
  managed: boolean;
}

export interface SaveDevEnvironmentProfile {
  projectId: string;
  executable: string;
  args: string[];
  healthPath: string;
  healthMarker: string;
}
