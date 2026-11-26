// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentQuestion } from '../../src/shared/agent-questions';
import { AgentQuestions } from '../../src/renderer/components/AgentQuestions';

const originalApi = Object.getOwnPropertyDescriptor(window, 'studio');
const originalAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalApi) Object.defineProperty(window, 'studio', originalApi); else Reflect.deleteProperty(window, 'studio');
  if (originalAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalAct);
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
});

it('lets a user answer one receivable question from the decision view', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  const question: AgentQuestion = {
    id: 'question-1', projectId: 'project-1', cardId: 'card-1', cardTitle: 'Login',
    sessionId: 'session-1', agentName: 'Codex', cardRevision: 2, currentRevision: 2,
    cardArchived: false, sessionState: 'running', question: 'Which sign-in flow should I build?',
    askedAt: '2026-11-26T09:00:00.000Z', answerId: null, answer: null, answerSource: null,
    answeredAt: null, delivery: 'open', deliveredAt: null, deliveryNote: null, receivable: true,
  };
  let answered = false;
  const agentQuestions = vi.fn().mockImplementation(async () => [answered ? { ...question, answerId: 'answer-1',
    answer: 'Email first.', answerSource: 'user', delivery: 'delivered', receivable: false } : question]);
  const answerAgentQuestions = vi.fn().mockImplementation(async () => { answered = true; return []; });
  Object.defineProperty(window, 'studio', { configurable: true, value: { agentQuestions, answerAgentQuestions } });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<AgentQuestions projectId="project-1" onOpenCard={() => undefined} onOpenSession={() => undefined} />); });
    const choose = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Antworten');
    expect(choose).toBeDefined();
    await act(async () => { choose?.click(); });
    const answer = host.querySelector<HTMLTextAreaElement>('textarea');
    expect(answer).not.toBeNull();
    expect(host.textContent).toContain('Prüfe die ursprüngliche Frage und die betroffene Sitzung.');
    expect(answer?.closest('label')?.textContent).toBe('Antwort');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(answer, 'Email first.');
      answer?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Antwort senden');
    expect(send?.disabled).toBe(false);
    await act(async () => { send?.click(); });
    expect(answerAgentQuestions).toHaveBeenCalledWith({ projectId: 'project-1', questionIds: ['question-1'],
      expectedRevisions: { 'question-1': 2 }, answer: 'Email first.' });
    expect(host.textContent).toContain('An diese Sitzung zugestellt');
    expect(host.textContent).toContain('Email first.');
  } finally { await act(async () => { root.unmount(); }); host.remove(); }
});
