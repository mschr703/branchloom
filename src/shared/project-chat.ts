import type { DraftTurn } from './task-draft';
import type { ProjectMemoryHit, ProjectMemoryIndexStatus } from './project-memory-index';

export interface ProjectChatInput { projectId: string; turns: DraftTurn[] }
export interface ProjectChatSuggestion {
  kind: 'task' | 'canvas';
  title: string;
  body: string;
  steps: string[];
}
export interface ProjectChatReply {
  answer: string;
  sources: ProjectMemoryHit[];
  index: ProjectMemoryIndexStatus;
  suggestion: ProjectChatSuggestion | null;
}
