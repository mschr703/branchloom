export type AgentQuestionDelivery = 'open' | 'prepared' | 'delivered' | 'stale' | 'failed';

export interface AgentQuestion {
  id: string;
  projectId: string;
  cardId: string;
  cardTitle: string;
  sessionId: string;
  agentName: string;
  cardRevision: number;
  currentRevision: number;
  cardArchived: boolean;
  sessionState: string;
  question: string;
  askedAt: string;
  answerId: string | null;
  answer: string | null;
  answerSource: 'user' | null;
  answeredAt: string | null;
  delivery: AgentQuestionDelivery;
  deliveredAt: string | null;
  deliveryNote: string | null;
  /** Current server-side delivery eligibility, including the exact active card session. */
  receivable: boolean;
}

export interface AgentQuestionSuggestion {
  questionIds: string[];
  commonTerms: string[];
}

export interface AnswerAgentQuestions {
  projectId: string;
  questionIds: string[];
  expectedRevisions: Record<string, number>;
  answer: string;
}
