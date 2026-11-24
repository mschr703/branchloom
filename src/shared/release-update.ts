export type ReleaseUpdatePhase = 'unsupported' | 'current' | 'available' | 'downloading' | 'installing' | 'blocked' | 'error';

export interface ReleaseUpdateState {
  phase: ReleaseUpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  percent: number | null;
  message: string | null;
}
