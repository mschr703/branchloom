import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentQuestionSuggestionList } from '../../src/renderer/components/AgentQuestions';
import type { AgentQuestion } from '../../src/shared/agent-questions';

function question(id: string, cardId: string): AgentQuestion {
  return {
    id, projectId: 'project', cardId, cardTitle: cardId, sessionId: id, agentName: 'Synthetic',
    cardRevision: 2, currentRevision: 2, cardArchived: false, sessionState: 'running',
    question: 'Can members edit archived projects?', askedAt: '2026-11-25T01:00:00Z',
    answerId: null, answer: null, answerSource: null, answeredAt: null, delivery: 'open',
    deliveredAt: null, deliveryNote: null, receivable: true,
  };
}

describe('agent question suggestion presentation', () => {
  it('shows original questions, concrete common terms, and only a selection action', () => {
    const questions = [question('q1', 'Frontend'), question('q2', 'Backend')];
    const html = renderToStaticMarkup(createElement(AgentQuestionSuggestionList, {
      questions, suggestions: [{ questionIds: ['q1', 'q2'], commonTerms: ['members', 'archived', 'projects'] }],
      disabled: false, onSelect: () => undefined,
    }));
    expect(html).toContain('Frontend: Can members edit archived projects?');
    expect(html).toContain('Backend: Can members edit archived projects?');
    expect(html).toContain('Gemeinsame Begriffe: members, archived, projects');
    expect(html).toContain('Empfänger prüfen');
    expect(html).not.toContain('Einmal beantworten');
  });
});
