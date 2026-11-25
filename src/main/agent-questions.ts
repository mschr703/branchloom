import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentQuestion, AnswerAgentQuestions, AgentQuestionDelivery } from '../shared/agent-questions';
import type { StudioStore } from './store';

type Row = {
  id: string; project_id: string; card_id: string; card_title: string; session_id: string;
  agent_name: string; card_revision: number; current_revision: number; card_archived_at: string | null; session_state: string;
  question: string; asked_at: string; answer_id: string | null; answer: string | null; answer_source: 'user' | null;
  answered_at: string | null; delivery: AgentQuestionDelivery; delivered_at: string | null;
  delivery_note: string | null;
};

export function installAgentQuestions(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS agent_question_answers (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    answer TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user' CHECK(source = 'user'), created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_questions (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, card_revision INTEGER NOT NULL,
    question TEXT NOT NULL, asked_at TEXT NOT NULL,
    answer_id TEXT REFERENCES agent_question_answers(id),
    delivery TEXT NOT NULL DEFAULT 'open' CHECK(delivery IN ('open','prepared','delivered','stale','failed')),
    delivered_at TEXT, delivery_note TEXT,
    UNIQUE(session_id, request_id)
  );
  CREATE INDEX IF NOT EXISTS agent_questions_project_recent ON agent_questions(project_id, asked_at DESC);`);
}

function questionRow(store: StudioStore, id: string): Row | undefined {
  return store.db.prepare(`SELECT q.*, c.title AS card_title, c.content_revision AS current_revision,
    c.archived_at AS card_archived_at,
    s.state AS session_state, a.name AS agent_name,
    answer.answer, answer.source AS answer_source, answer.created_at AS answered_at
    FROM agent_questions q JOIN cards c ON c.id = q.card_id AND c.project_id = q.project_id
    JOIN sessions s ON s.id = q.session_id AND s.card_id = q.card_id AND s.project_id = q.project_id
    JOIN agents a ON a.id = s.agent_id
    LEFT JOIN agent_question_answers answer ON answer.id = q.answer_id
    WHERE q.id = ?`).get(id) as Row | undefined;
}

function asQuestion(row: Row): AgentQuestion {
  return {
    id: row.id, projectId: row.project_id, cardId: row.card_id, cardTitle: row.card_title,
    sessionId: row.session_id, agentName: row.agent_name, cardRevision: row.card_revision,
    currentRevision: row.current_revision, cardArchived: Boolean(row.card_archived_at), sessionState: row.session_state, question: row.question,
    askedAt: row.asked_at, answerId: row.answer_id, answer: row.answer, answerSource: row.answer_source,
    answeredAt: row.answered_at, delivery: row.delivery, deliveredAt: row.delivered_at,
    deliveryNote: row.delivery_note,
  };
}

export function agentQuestions(store: StudioStore, projectId: string): AgentQuestion[] {
  store.project(projectId);
  const rows = store.db.prepare(`SELECT q.id FROM agent_questions q WHERE q.project_id = ?
    ORDER BY CASE WHEN q.answer_id IS NULL THEN 0 ELSE 1 END, q.asked_at DESC, q.id DESC LIMIT 100`)
    .all(projectId) as Array<{ id: string }>;
  return rows.map((row) => questionRow(store, row.id)).filter((row): row is Row => Boolean(row)).map(asQuestion);
}

/** The local token bridge supplies the session ID; the agent cannot select another card or run. */
export function recordAgentQuestion(store: StudioStore, input: { sessionId: string; requestId: string; question: string }): AgentQuestion {
  if (!input || typeof input.sessionId !== 'string' || typeof input.requestId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
    || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 2_000 || /\0/.test(input.question)) {
    throw new Error('Invalid agent question.');
  }
  return store.db.transaction(() => {
    const session = store.session(input.sessionId);
    if (session.state !== 'running') throw new Error('The session is no longer running.');
    const card = store.card(session.cardId);
    if (card.projectId !== session.projectId || card.archivedAt) throw new Error('The session card is unavailable.');
    const revision = store.db.prepare('SELECT content_revision FROM session_card_revisions WHERE session_id = ? AND card_id = ?')
      .get(session.id, card.id) as { content_revision: number } | undefined;
    const current = store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(card.id) as { content_revision: number };
    if (!revision || revision.content_revision !== current.content_revision) throw new Error('The card changed after this session started.');
    const existing = store.db.prepare('SELECT id, question FROM agent_questions WHERE session_id = ? AND request_id = ?')
      .get(session.id, input.requestId) as { id: string; question: string } | undefined;
    if (existing) {
      if (existing.question !== input.question.trim()) throw new Error('Request ID already belongs to a different question.');
      return asQuestion(questionRow(store, existing.id)!);
    }
    const count = store.db.prepare('SELECT COUNT(*) AS count FROM agent_questions WHERE session_id = ?').get(session.id) as { count: number };
    if (count.count >= 20) throw new Error('This session already recorded 20 questions.');
    const id = randomUUID();
    store.db.prepare(`INSERT INTO agent_questions (id, project_id, card_id, session_id, request_id, card_revision, question, asked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, card.projectId, card.id, session.id, input.requestId, current.content_revision, input.question.trim(), new Date().toISOString());
    return asQuestion(questionRow(store, id)!);
  }).immediate();
}

function assertReceivable(store: StudioStore, row: Row): void {
  if (row.card_archived_at) throw new Error(`Card ${row.card_id} is archived.`);
  if (row.session_state !== 'running') throw new Error(`Session ${row.session_id} is no longer running.`);
  if (row.current_revision !== row.card_revision) throw new Error(`Card ${row.card_id} changed since the question was asked.`);
  const latest = store.latestSession(row.card_id);
  if (latest?.id !== row.session_id) throw new Error(`Card ${row.card_id} now has a different session.`);
}

function terminalLine(value: string): string {
  // A shared answer is one terminal message even when the stored text has line breaks or escapes.
  return JSON.stringify(value.replace(/[\u0000-\u001f\u007f]/g, ' '));
}

function terminalMessage(row: Row, answer: string): string {
  return `[Branchloom shared answer for question ${row.id}] Original question: ${terminalLine(row.question)}. Decision: ${terminalLine(answer)}. Please confirm in your work whether you applied this decision.`;
}

/** Prepare once, then send to each exact live session. A crash never silently replays a prepared answer. */
export function answerAgentQuestions(store: StudioStore, input: AnswerAgentQuestions,
  send: (sessionId: string, text: string) => void): AgentQuestion[] {
  if (!input || typeof input.projectId !== 'string' || !Array.isArray(input.questionIds)
    || input.questionIds.length < 2 || input.questionIds.length > 12
    || input.questionIds.some((id) => typeof id !== 'string' || !id)
    || new Set(input.questionIds).size !== input.questionIds.length
    || !input.expectedRevisions || typeof input.expectedRevisions !== 'object'
    || Array.isArray(input.expectedRevisions) || typeof input.answer !== 'string'
    || !input.answer.trim() || input.answer.length > 4_000 || /\0/.test(input.answer)) {
    throw new Error('Invalid shared answer.');
  }
  const text = input.answer.trim();
  const prepared = store.db.transaction(() => {
    store.project(input.projectId);
    const rows = input.questionIds.map((id) => questionRow(store, id));
    if (rows.some((row) => !row || row.project_id !== input.projectId)) throw new Error('Question belongs to another project or no longer exists.');
    const questions = rows as Row[];
    if (new Set(questions.map((row) => row.card_id)).size < 2) throw new Error('Select questions from at least two different cards.');
    for (const row of questions) {
      if (row.answer_id || row.delivery !== 'open') throw new Error('A selected question is already answered.');
      if (input.expectedRevisions[row.id] !== row.card_revision) throw new Error('Question revision changed; refresh the inbox.');
      assertReceivable(store, row);
      if (terminalMessage(row, text).length > 10_000) throw new Error('Shared answer is too long for this terminal session.');
    }
    const id = randomUUID();
    store.db.prepare("INSERT INTO agent_question_answers (id, project_id, answer, source, created_at) VALUES (?, ?, ?, 'user', ?)")
      .run(id, input.projectId, text, new Date().toISOString());
    const update = store.db.prepare("UPDATE agent_questions SET answer_id = ?, delivery = 'prepared' WHERE id = ? AND answer_id IS NULL");
    for (const row of questions) update.run(id, row.id);
    return questions.map((row) => row.id);
  }).immediate();
  for (const id of prepared) {
    const row = questionRow(store, id)!;
    try {
      assertReceivable(store, row);
      send(row.session_id, terminalMessage(row, text));
      store.db.prepare("UPDATE agent_questions SET delivery = 'delivered', delivered_at = ?, delivery_note = NULL WHERE id = ? AND delivery = 'prepared'")
        .run(new Date().toISOString(), id);
    } catch (error) {
      const note = error instanceof Error ? error.message.slice(0, 300) : 'Delivery failed.';
      const stale = /not running|changed|different session|archived/i.test(note);
      store.db.prepare("UPDATE agent_questions SET delivery = ?, delivery_note = ? WHERE id = ? AND delivery = 'prepared'")
        .run(stale ? 'stale' : 'failed', note, id);
    }
  }
  return prepared.map((id) => asQuestion(questionRow(store, id)!));
}
