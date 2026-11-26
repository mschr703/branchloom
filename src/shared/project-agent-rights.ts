export type CodexWorkflowAccessMode = 'workspace' | 'full';

export interface ProjectCodexWorkflowAccess {
  projectId: string;
  mode: CodexWorkflowAccessMode;
}

export interface SetProjectCodexWorkflowAccessInput extends ProjectCodexWorkflowAccess {
  acknowledgeFullAccess?: boolean;
}
