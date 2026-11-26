import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCardMetadataBridge } from '../../src/main/agent-card-metadata-bridge';
import { agentQuestionDecisionCount, agentQuestions, answerAgentQuestions, recordAgentQuestion } from '../../src/main/agent-questions';
import { suggestAgentQuestionGroups } from '../../src/shared/agent-question-suggestions';
import { SessionRunner } from '../../src/main/cli';
import { StudioStore } from '../../src/main/store';

const roots: string[] = [];
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  for (const root of roots.splice(0)) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '')) throw error;
    }
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-agent-questions-')); roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic', path: root });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const agentId = store.agents()[0]!.id;
  const cards = ['Frontend', 'Backend', 'Unrelated'].map((title) => store.createCard({ projectId: project.id, columnId, title }));
  const runs = cards.map((card) => {
    const run = store.createSession({ cardId: card.id, agentId });
    const revision = (store.db.prepare('SELECT content_revision AS revision FROM cards WHERE id = ?').get(card.id) as { revision: number }).revision;
    store.db.prepare('INSERT INTO session_card_revisions (session_id, card_id, content_revision) VALUES (?, ?, ?)').run(run.id, card.id, revision);
    return run;
  });
  const questions = runs.map((run, index) => recordAgentQuestion(store, { sessionId: run.id, requestId: randomUUID(), question: `Can card ${index + 1} edit archived projects?` }));
  return { root, file, store, project, cards, runs, questions };
}

function answerInput(fixture: ReturnType<typeof fixture>, ids = [0, 1]) {
  return { projectId: fixture.project.id, questionIds: ids.map((index) => fixture.questions[index]!.id),
    expectedRevisions: Object.fromEntries(ids.map((index) => [fixture.questions[index]!.id, fixture.questions[index]!.cardRevision])),
    answer: 'Archived projects are read-only.' };
}

describe('shared agent questions', () => {
  it('counts only currently answerable questions for the decision indicator', () => {
    const f = fixture();
    try {
      expect(agentQuestionDecisionCount(f.store, f.project.id)).toBe(3);
      answerAgentQuestions(f.store, answerInput(f, [0]), () => undefined);
      expect(agentQuestionDecisionCount(f.store, f.project.id)).toBe(2);
      f.store.updateCard({ id: f.cards[1]!.id, description: 'New scope' });
      expect(agentQuestionDecisionCount(f.store, f.project.id)).toBe(1);
      f.store.finishSession(f.runs[2]!.id, 'stopped', null);
      expect(agentQuestionDecisionCount(f.store, f.project.id)).toBe(0);
      expect(() => agentQuestionDecisionCount(f.store, 'other-project')).toThrow();
    } finally { f.store.close(); }
  });
  it('answers one exact live question without touching other cards and never resends it on retry', () => {
    const f = fixture();
    const sent: Array<{ sessionId: string; text: string }> = [];
    try {
      const input = answerInput(f, [0]);
      const [result] = answerAgentQuestions(f.store, input, (sessionId, text) => sent.push({ sessionId, text }));
      expect(result).toMatchObject({ sessionId: f.runs[0]!.id, delivery: 'delivered', answer: input.answer });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain(f.questions[0]!.question);
      expect(agentQuestions(f.store, f.project.id).filter((row) => row.answerId === null)).toHaveLength(2);
      expect(() => answerAgentQuestions(f.store, input, () => sent.push({ sessionId: 'unexpected', text: '' }))).toThrow('already answered');
      expect(sent).toHaveLength(1);
    } finally { f.store.close(); }
    const reopened = new StudioStore(f.file);
    try {
      expect(agentQuestions(reopened, f.project.id).find((row) => row.id === f.questions[0]!.id)).toMatchObject({
        answerSource: 'user', delivery: 'delivered', answer: 'Archived projects are read-only.',
      });
    } finally { reopened.close(); }
  });

  it('rejects a single question after its card changes or session ends', () => {
    const f = fixture();
    try {
      f.store.updateCard({ id: f.cards[0]!.id, description: 'New direction' });
      expect(() => answerAgentQuestions(f.store, answerInput(f, [0]), () => undefined)).toThrow('changed');
      expect(agentQuestions(f.store, f.project.id).find((row) => row.id === f.questions[0]!.id)?.answerId).toBeNull();
      f.store.finishSession(f.runs[1]!.id, 'stopped', null);
      expect(() => answerAgentQuestions(f.store, answerInput(f, [1]), () => undefined)).toThrow('no longer running');
      expect(agentQuestions(f.store, f.project.id).find((row) => row.id === f.questions[1]!.id)?.answerId).toBeNull();
    } finally { f.store.close(); }
  });

  it('suggests two currently receivable questions without writing an answer, then drops a stale card', () => {
    const f = fixture();
    try {
      const a = recordAgentQuestion(f.store, { sessionId: f.runs[0]!.id, requestId: randomUUID(), question: 'Can members edit archived projects?' });
      const b = recordAgentQuestion(f.store, { sessionId: f.runs[1]!.id, requestId: randomUUID(), question: 'Are members allowed to edit archived projects?' });
      const initial = agentQuestions(f.store, f.project.id);
      expect(initial.find((item) => item.id === a.id)?.receivable).toBe(true);
      expect(initial.find((item) => item.id === b.id)?.receivable).toBe(true);
      expect(suggestAgentQuestionGroups(initial)[0]?.questionIds).toHaveLength(2);
      expect(suggestAgentQuestionGroups(initial)[0]?.questionIds).toEqual(expect.arrayContaining([a.id, b.id]));
      expect(initial.every((item) => item.answerId === null && item.delivery === 'open')).toBe(true);
      f.store.updateCard({ id: f.cards[1]!.id, description: 'Revised scope' });
      const changed = agentQuestions(f.store, f.project.id);
      expect(changed.find((item) => item.id === b.id)?.receivable).toBe(false);
      expect(suggestAgentQuestionGroups(changed)).toEqual([]);
    } finally { f.store.close(); }
  });
  it('answers two exact live sessions once, leaves a third untouched and retains source after restart', () => {
    const f = fixture();
    const sent: Array<{ sessionId: string; text: string }> = [];
    const result = answerAgentQuestions(f.store, answerInput(f), (sessionId, text) => sent.push({ sessionId, text }));
    expect(result.map((row) => row.delivery)).toEqual(['delivered', 'delivered']);
    expect(result[0]!.answerId).toBe(result[1]!.answerId);
    expect(sent.map((item) => item.sessionId)).toEqual([f.runs[0]!.id, f.runs[1]!.id]);
    expect(sent[0]!.text).toContain(f.questions[0]!.question);
    expect(sent[1]!.text).toContain('Archived projects are read-only.');
    expect(agentQuestions(f.store, f.project.id).find((row) => row.id === f.questions[2]!.id)).toMatchObject({ answer: null, delivery: 'open' });
    expect(() => answerAgentQuestions(f.store, answerInput(f), () => undefined)).toThrow('already answered');
    f.store.close();
    const reopened = new StudioStore(f.file);
    try {
      const saved = agentQuestions(reopened, f.project.id);
      expect(saved.find((row) => row.id === f.questions[0]!.id)).toMatchObject({ cardTitle: 'Frontend', sessionId: f.runs[0]!.id,
        question: f.questions[0]!.question, answer: 'Archived projects are read-only.', answerSource: 'user', delivery: 'delivered' });
      expect(saved.find((row) => row.id === f.questions[2]!.id)?.answer).toBeNull();
    } finally { reopened.close(); }
  });

  it('rejects an ended session or changed card before preparing any answer', () => {
    const f = fixture();
    try {
      f.store.finishSession(f.runs[1]!.id, 'stopped', null);
      expect(() => answerAgentQuestions(f.store, answerInput(f), () => undefined)).toThrow('no longer running');
      expect(agentQuestions(f.store, f.project.id).every((row) => row.answerId === null)).toBe(true);
      const next = f.store.createSession({ cardId: f.cards[1]!.id, agentId: f.runs[1]!.agentId });
      expect(next.id).not.toBe(f.runs[1]!.id);
      expect(() => answerAgentQuestions(f.store, answerInput(f), () => undefined)).toThrow('no longer running');
      f.store.updateCard({ id: f.cards[0]!.id, description: 'Changed requirement' });
      expect(() => recordAgentQuestion(f.store, { sessionId: f.runs[0]!.id, requestId: randomUUID(), question: 'New question?' })).toThrow('changed');
    } finally { f.store.close(); }
  });

  it('rejects duplicate, same-card and cross-project recipient sets', () => {
    const f = fixture();
    try {
      const firstId = f.questions[0]!.id;
      expect(() => answerAgentQuestions(f.store, { ...answerInput(f), questionIds: [firstId, firstId] }, () => undefined)).toThrow('Invalid shared answer');
      const another = recordAgentQuestion(f.store, { sessionId: f.runs[0]!.id, requestId: randomUUID(), question: 'Second question on the same card?' });
      expect(() => answerAgentQuestions(f.store, { ...answerInput(f), questionIds: [firstId, another.id],
        expectedRevisions: { [firstId]: f.questions[0]!.cardRevision, [another.id]: another.cardRevision } }, () => undefined)).toThrow('different cards');
      const outsidePath = join(f.root, 'other'); mkdirSync(outsidePath);
      const outside = f.store.createProject({ name: 'Other project', path: outsidePath });
      const outsideCard = f.store.createCard({ projectId: outside.id, columnId: f.store.snapshot(outside.id).columns[0]!.id, title: 'Outside' });
      const outsideRun = f.store.createSession({ cardId: outsideCard.id, agentId: f.runs[0]!.agentId });
      f.store.db.prepare('INSERT INTO session_card_revisions (session_id, card_id, content_revision) VALUES (?, ?, 0)').run(outsideRun.id, outsideCard.id);
      const other = recordAgentQuestion(f.store, { sessionId: outsideRun.id, requestId: randomUUID(), question: 'Other project question?' });
      expect(() => answerAgentQuestions(f.store, { ...answerInput(f), questionIds: [firstId, other.id],
        expectedRevisions: { [firstId]: f.questions[0]!.cardRevision, [other.id]: other.cardRevision } }, () => undefined)).toThrow('another project');
      expect(agentQuestions(f.store, f.project.id).every((row) => row.answerId === null)).toBe(true);
    } finally { f.store.close(); }
  });

  it('records per-recipient send failures and never pretends the agent applied the answer', () => {
    const f = fixture();
    try {
      const result = answerAgentQuestions(f.store, answerInput(f), (sessionId) => {
        if (sessionId === f.runs[1]!.id) throw new Error('Synthetic PTY write failure');
      });
      expect(result.map((row) => row.delivery)).toEqual(['delivered', 'failed']);
      expect(result[1]!.deliveryNote).toContain('Synthetic PTY');
      expect(result.every((row) => row.answerId === result[0]!.answerId)).toBe(true);
      expect(agentQuestions(f.store, f.project.id)[0]!.delivery).toBe('open');
    } finally { f.store.close(); }
  });

  it('keeps multiline decision text inside one terminal message per recipient', () => {
    const f = fixture();
    try {
      const sent: string[] = [];
      answerAgentQuestions(f.store, { ...answerInput(f), answer: 'First line\nSecond line\u001b[31m' }, (_sessionId, text) => sent.push(text));
      expect(sent).toHaveLength(2);
      expect(sent[0]).not.toMatch(/[\r\n\u001b]/);
      expect(sent[0]).toContain('First line Second line');
    } finally { f.store.close(); }
  });

  it('rejects a terminal payload that would exceed the adapter limit before saving', () => {
    const f = fixture();
    try {
      const longQuestion = recordAgentQuestion(f.store, { sessionId: f.runs[0]!.id, requestId: randomUUID(), question: '\\'.repeat(2_000) });
      const second = f.questions[1]!;
      const input = { projectId: f.project.id, questionIds: [longQuestion.id, second.id],
        expectedRevisions: { [longQuestion.id]: longQuestion.cardRevision, [second.id]: second.cardRevision }, answer: '\\'.repeat(4_000) };
      expect(() => answerAgentQuestions(f.store, input, () => undefined)).toThrow('too long');
      expect(agentQuestions(f.store, f.project.id).every((row) => row.answerId === null)).toBe(true);
    } finally { f.store.close(); }
  });

  it('accepts a card-scoped question from the loopback token even when metadata edits are disabled', async () => {
    const f = fixture();
    const bridge = new AgentCardMetadataBridge(f.store, () => undefined);
    await bridge.start();
    try {
      const env = bridge.environment(f.runs[0]!.id);
      expect(env.BRANCHLOOM_CARD_METADATA_URL).toBeUndefined();
      expect(bridge.instructions(f.project.id)).toContain('BRANCHLOOM_AGENT_QUESTION_URL');
      const token = env.BRANCHLOOM_AGENT_QUESTION_TOKEN!;
      const url = env.BRANCHLOOM_AGENT_QUESTION_URL!;
      const requestId = randomUUID();
      const request = () => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, question: 'Should archived projects be editable?' }) });
      const first = await request();
      expect(first.status).toBe(200);
      expect((await request()).status).toBe(200);
      expect((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://invalid.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: randomUUID(), question: 'Forbidden origin?' }) })).status).toBe(403);
      expect(agentQuestions(f.store, f.project.id).filter((row) => row.sessionId === f.runs[0]!.id)).toHaveLength(2);
      bridge.revoke(f.runs[0]!.id);
      expect((await request()).status).toBe(401);
    } finally { bridge.close(); f.store.close(); }
  });

  it('delivers one decision to two real isolated CLI sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'branchloom-shared-question-live-')); roots.push(root);
    const repo = join(root, 'repo'); mkdirSync(repo);
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 10_000 });
      if (result.status !== 0) throw new Error(String(result.stderr || result.error));
    };
    git('init', '-q'); writeFileSync(join(repo, 'README.md'), 'synthetic project');
    git('add', 'README.md'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
    const script = join(root, 'question-agent.cjs');
    writeFileSync(script, `const { randomUUID } = require('node:crypto');
(async () => {
  const response = await fetch(process.env.BRANCHLOOM_AGENT_QUESTION_URL, {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.BRANCHLOOM_AGENT_QUESTION_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: randomUUID(), question: 'May archived projects be edited?' })
  });
  if (!response.ok) throw new Error('Question tool: ' + response.status);
  console.log('QUESTION_POSTED');
  let received = '';
  process.stdin.on('data', (chunk) => { received += String(chunk); if (received.includes('Archived projects are read-only.')) { console.log('ANSWER_RECEIVED'); process.exit(0); } });
  process.stdin.resume();
})().catch((error) => { console.error(error.message); process.exit(1); });\n`);
    const store = new StudioStore(join(root, 'studio.sqlite'));
    const project = store.createProject({ name: 'Synthetic live', path: repo });
    const columnId = store.snapshot(project.id).columns[0]!.id;
    const agent = store.saveAgent({ name: 'Question fixture', kind: 'custom', command: process.execPath, args: [script], model: null, enabled: true });
    const cards = ['Frontend', 'Backend'].map((title) => store.createCard({ projectId: project.id, columnId, title }));
    const bridge = new AgentCardMetadataBridge(store, () => undefined);
    await bridge.start();
    const runner = new SessionRunner(store, () => undefined, () => undefined, bridge);
    try {
      const runs = cards.map((card) => runner.start({ cardId: card.id, agentId: agent.id, prompt: '', mode: 'one-shot', useWorktree: true }));
      let pending = agentQuestions(store, project.id);
      for (let attempt = 0; attempt < 100 && pending.length < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        pending = agentQuestions(store, project.id);
      }
      expect(pending).toHaveLength(2);
      const delivered = answerAgentQuestions(store, { projectId: project.id, questionIds: pending.map((item) => item.id),
        expectedRevisions: Object.fromEntries(pending.map((item) => [item.id, item.cardRevision])), answer: 'Archived projects are read-only.' },
      (sessionId, text) => runner.send({ sessionId, text }));
      expect(delivered.map((item) => item.delivery)).toEqual(['delivered', 'delivered']);
      for (let attempt = 0; attempt < 100 && runs.some((run) => store.session(run.id).state === 'running'); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const run of runs) {
        expect(store.session(run.id)).toMatchObject({ state: 'exited', exitCode: 0 });
        expect(store.session(run.id).output).toContain('ANSWER_RECEIVED');
      }
    } finally { runner.dispose(); bridge.close(); store.close(); }
  }, 30_000);
});
