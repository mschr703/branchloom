import { describe, expect, it } from 'vitest';
import { suggestAgentQuestionGroups } from '../../src/shared/agent-question-suggestions';
import type { AgentQuestion } from '../../src/shared/agent-questions';

function question(id: string, cardId: string, text: string, extras: Partial<AgentQuestion> = {}): AgentQuestion {
  return {
    id, projectId: 'project', cardId, cardTitle: cardId, sessionId: `session-${id}`, agentName: 'Synthetic',
    cardRevision: 1, currentRevision: 1, cardArchived: false, sessionState: 'running',
    question: text, askedAt: `2026-11-25T01:00:0${id}.000Z`, answerId: null, answer: null,
    answerSource: null, answeredAt: null, delivery: 'open', deliveredAt: null, deliveryNote: null,
    receivable: true, ...extras,
  };
}

describe('conservative agent question suggestions', () => {
  it('suggests matching live questions from different cards with explainable common terms', () => {
    const a = question('1', 'frontend', 'Dürfen Mitglieder archivierte Projekte bearbeiten?');
    const b = question('2', 'backend', 'Können Mitglieder archivierte Projekte bearbeiten?');
    const unrelated = question('3', 'tests', 'Sollen Gäste öffentliche Dateien herunterladen?');
    const result = suggestAgentQuestionGroups([a, b, unrelated]);
    expect(result).toHaveLength(1);
    expect(result[0]?.questionIds).toEqual(['2', '1']);
    expect(result[0]?.commonTerms).toEqual(['mitglieder', 'archivierte', 'projekte', 'bearbeiten']);
    expect(result[0]?.questionIds).not.toContain(unrelated.id);
  });

  it('does not combine changed scope, negation, modal obligation, numbers, or same-card questions', () => {
    const base = question('1', 'frontend', 'Can members edit archived projects?');
    for (const different of [
      question('2', 'backend', 'Can members edit active projects?'),
      question('2', 'backend', 'Can members not edit archived projects?'),
      question('2', 'backend', 'Must members edit archived projects?'),
      question('2', 'backend', 'Can members edit archived projects within 30 days?'),
      question('2', 'frontend', 'Can members edit archived projects?'),
    ]) expect(suggestAgentQuestionGroups([base, different])).toEqual([]);
  });

  it('ignores stale, answered, and foreign-project candidates even with identical wording', () => {
    const base = question('1', 'frontend', 'Can members edit archived projects?');
    for (const blocked of [
      question('2', 'backend', base.question, { receivable: false, sessionState: 'stopped' }),
      question('2', 'backend', base.question, { receivable: false, currentRevision: 2 }),
      question('2', 'backend', base.question, { answerId: 'answer', delivery: 'delivered' }),
      question('2', 'backend', base.question, { projectId: 'foreign' }),
    ]) expect(suggestAgentQuestionGroups([base, blocked])).toEqual([]);
  });

  it('keeps suggestions pairwise coherent instead of chaining unrelated scopes', () => {
    const questions = [
      question('1', 'a', 'Can members edit archived project settings?'),
      question('2', 'b', 'Can members edit archived project settings safely?'),
      question('3', 'c', 'Can members edit project settings safely for guests?'),
    ];
    const result = suggestAgentQuestionGroups(questions);
    expect(result).toHaveLength(1);
    expect(result[0]?.questionIds).toEqual(['2', '1']);
  });
});
