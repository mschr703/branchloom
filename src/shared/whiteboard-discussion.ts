export type WhiteboardDiscussionDraft =
  | { kind: 'node'; title: string; description: string }
  | { kind: 'edge'; sourceId: string; targetId: string; label: string };

export interface WhiteboardDiscussionInput {
  projectId: string;
  nodeIds: string[];
  question: string;
  draft?: WhiteboardDiscussionDraft | null;
}

export interface WhiteboardDiscussionSource {
  id: string;
  title: string;
  description: string;
  reference: string | null;
  cardStatus: string | null;
  updatedAt: string;
}

export interface WhiteboardDiscussionReply {
  answer: string;
  citedNodeIds: string[];
  citedProjectSourceIds: string[];
  sources: WhiteboardDiscussionSource[];
  projectSources: Array<{ id: string; title: string; kind: string; snippet: string; updatedAt: string }>;
  indexedAt: string | null;
  connections: Array<{ sourceId: string; targetId: string; label: string }>;
  suggestedTitle: string;
  suggestedDescription: string;
}
