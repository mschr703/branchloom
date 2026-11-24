import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { approveCardDependency, cardRunGate, reserveCardSession, setCardRunDependencies, setProjectRunCapacity } from '../../src/main/parallel-runs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-parallel-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Parallel fixture', path: root });
  const column = store.snapshot(project.id).columns[0]!;
  const agent = store.saveAgent({ name: 'Fake', kind: 'custom', command: process.execPath, args: [], model: null, enabled: true });
  const first = store.createCard({ projectId: project.id, columnId: column.id, title: 'First' });
  const second = store.createCard({ projectId: project.id, columnId: column.id, title: 'Second' });
  return { root, file, store, project, agent, first, second };
}

function addDependency(store: StudioStore, firstId: string, secondId: string) {
  store.db.prepare('INSERT INTO card_splits (id, parent_card_id, child_card_id, depends_on_card_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), firstId, secondId, firstId, 1, new Date().toISOString());
}

function addQa(store: StudioStore, cardId: string, projectId: string, status: string, endedAt: string, startedAt = endedAt) {
  const id = randomUUID();
  const revision = (store.db.prepare('SELECT content_revision FROM cards WHERE id = ?').get(cardId) as { content_revision: number }).content_revision;
  store.db.prepare(`INSERT INTO card_qa_reports (id, card_id, project_id, requested_url, final_url, started_at, ended_at, status, diagnostics_json, content_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, cardId, projectId, 'http://127.0.0.1:5181', 'http://127.0.0.1:5181', startedAt, endedAt, status, '[]', revision);
  return id;
}

describe('parallel session reservation and dependency gate', () => {
  it('waits for both verified predecessors and persists the chosen dependency set', () => {
    const { file, store, project, agent, first, second } = fixture();
    const combined = store.createCard({ projectId: project.id, columnId: first.columnId, title: 'Integration test' });
    const configured = setCardRunDependencies(store, { cardId: combined.id, prerequisiteCardIds: [first.id, second.id] });
    expect(configured.dependencies.map((item) => item.prerequisiteCardId)).toEqual([first.id, second.id]);
    expect(configured.blockers).toHaveLength(2);
    const flow = store.createWorkflow({ projectId: project.id, name: 'Verified outcomes', cardIds: [first.id, second.id], steps: [
      { id: randomUUID(), columnId: first.columnId, agentId: agent.id, requireApproval: false },
    ] });
    store.setWorkflowState(flow.id, 'running');
    store.ensureWorkflowProgress(flow.id, 0, [first.id, second.id]);
    for (const card of [first, second]) {
      const run = reserveCardSession(store, { cardId: card.id, agentId: agent.id });
      store.beginWorkflowCard(flow.id, 0, card.id, run.id);
      store.finishSession(run.id, 'exited', 0);
      store.finishWorkflowCard(run.id, true);
      const gate = cardRunGate(store, combined.id);
      expect(gate.dependencies.filter((item) => item.status === 'blocked')).toHaveLength(card.id === first.id ? 1 : 0);
    }
    expect(cardRunGate(store, combined.id).canStart).toBe(true);
    store.close();
    const reopened = new StudioStore(file);
    try {
      expect(cardRunGate(reopened, combined.id).dependencies).toHaveLength(2);
      expect(cardRunGate(reopened, combined.id).canStart).toBe(true);
    } finally { reopened.close(); }
  });

  it('rejects cycles, cross-project predecessors and changes during a live card session', () => {
    const { root, store, project, agent, first, second } = fixture();
    setCardRunDependencies(store, { cardId: second.id, prerequisiteCardIds: [first.id] });
    expect(() => setCardRunDependencies(store, { cardId: first.id, prerequisiteCardIds: [second.id] })).toThrow('Zyklus');
    const otherPath = join(root, 'other');
    mkdirSync(otherPath);
    const otherProject = store.createProject({ name: 'Other', path: otherPath });
    const other = store.createCard({ projectId: otherProject.id, columnId: store.snapshot(otherProject.id).columns[0]!.id, title: 'Other task' });
    expect(() => setCardRunDependencies(store, { cardId: first.id, prerequisiteCardIds: [other.id] })).toThrow('desselben Projekts');
    const running = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    expect(() => setCardRunDependencies(store, { cardId: first.id, prerequisiteCardIds: [] })).toThrow('laufenden Karte');
    store.finishSession(running.id, 'stopped', null);
    expect(setCardRunDependencies(store, { cardId: second.id, prerequisiteCardIds: [] }).dependencies).toHaveLength(0);
    store.close();
  });

  it('keeps separate QA approvals for two predecessors and invalidates only the changed one', () => {
    const { store, project, agent, first, second } = fixture();
    const combined = store.createCard({ projectId: project.id, columnId: first.columnId, title: 'Integration test' });
    setCardRunDependencies(store, { cardId: combined.id, prerequisiteCardIds: [first.id, second.id] });
    const reports = [first, second].map((card) => {
      const run = reserveCardSession(store, { cardId: card.id, agentId: agent.id });
      store.finishSession(run.id, 'exited', 0);
      return addQa(store, card.id, project.id, 'passed', '2099-01-01T00:00:00.000Z');
    });
    expect(() => approveCardDependency(store, { cardId: combined.id, qaReportId: reports[0]!, note: 'First report is accepted' })).toThrow('auswählen');
    approveCardDependency(store, { cardId: combined.id, prerequisiteCardId: first.id, qaReportId: reports[0]!, note: 'First report is accepted' });
    expect(cardRunGate(store, combined.id).canStart).toBe(false);
    approveCardDependency(store, { cardId: combined.id, prerequisiteCardId: second.id, qaReportId: reports[1]!, note: 'Second report is accepted' });
    expect(cardRunGate(store, combined.id).canStart).toBe(true);
    store.updateCard({ id: first.id, title: 'First revised' });
    expect(cardRunGate(store, combined.id).dependencies.map((item) => item.status)).toEqual(['blocked', 'approved']);
    store.close();
  });

  it('migrates legacy duplicate running rows into reviewable interruptions before installing the unique index', () => {
    const { file, store, project, agent, first } = fixture();
    store.db.exec('DROP INDEX one_running_session_per_card');
    const oldA = store.createSession({ cardId: first.id, agentId: agent.id });
    const oldB = store.createSession({ cardId: first.id, agentId: agent.id });
    store.appendOutput(oldA.id, 'First partial transcript');
    store.appendOutput(oldB.id, 'Second partial transcript');
    store.close();
    const reopened = new StudioStore(file);
    try {
      expect([reopened.session(oldA.id).state, reopened.session(oldB.id).state]).toEqual(['failed', 'failed']);
      expect(reopened.interruptedSessions(project.id).map((row) => row.sessionId).sort()).toEqual([oldA.id, oldB.id].sort());
      expect(reopened.session(oldA.id).output).toContain('First partial transcript');
      expect(reopened.session(oldB.id).output).toContain('Second partial transcript');
      const fresh = reserveCardSession(reopened, { cardId: first.id, agentId: agent.id });
      expect(() => reopened.createSession({ cardId: first.id, agentId: agent.id })).toThrow('UNIQUE');
      reopened.finishSession(fresh.id, 'stopped', null);
    } finally { reopened.close(); }
  });

  it('serializes simultaneous reservation requests across two database handles', async () => {
    const { file, store, project, agent, first, second } = fixture();
    setProjectRunCapacity(store, { projectId: project.id, capacity: 1 });
    const peer = new StudioStore(file);
    try {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => reserveCardSession(store, { cardId: first.id, agentId: agent.id })),
        Promise.resolve().then(() => reserveCardSession(peer, { cardId: second.id, agentId: agent.id })),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(store.runningSessionsForProject(project.id)).toHaveLength(1);
    } finally { peer.close(); store.close(); }
  });

  it('keeps legacy QA without a start revision visible but ineligible after schema upgrade', () => {
    const { file, store, project, agent, first, second } = fixture();
    addDependency(store, first.id, second.id);
    const run = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    store.finishSession(run.id, 'exited', 0);
    const oldReport = addQa(store, first.id, project.id, 'passed', '2099-01-01T00:00:00.000Z');
    store.db.exec('ALTER TABLE card_qa_reports DROP COLUMN content_revision');
    store.close();
    const upgraded = new StudioStore(file);
    try {
      const row = upgraded.db.prepare('SELECT content_revision FROM card_qa_reports WHERE id = ?').get(oldReport) as { content_revision: number | null };
      expect(row.content_revision).toBeNull();
      expect(cardRunGate(upgraded, second.id).dependency?.reports).toEqual([]);
      expect(() => approveCardDependency(upgraded, { cardId: second.id, qaReportId: oldReport, note: 'Legacy QA was passed' })).toThrow('aktueller');
    } finally { upgraded.close(); }
  });

  it('reserves one live session per card atomically and starts no duplicate after restart', () => {
    const { file, store, project, agent, first, second } = fixture();
    setProjectRunCapacity(store, { projectId: project.id, capacity: 1 });
    const run = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    expect(() => reserveCardSession(store, { cardId: first.id, agentId: agent.id })).toThrow('bereits ein Agent');
    expect(() => reserveCardSession(store, { cardId: second.id, agentId: agent.id })).toThrow('Projektkapazität');
    expect(store.latestSession(second.id)).toBeNull();
    store.close();
    const reopened = new StudioStore(file);
    try {
      expect(reopened.session(run.id).state).toBe('failed');
      expect(cardRunGate(reopened, second.id).capacity).toBe(1);
      expect(cardRunGate(reopened, second.id).canStart).toBe(true);
      expect(reopened.latestSession(second.id)).toBeNull();
    } finally { reopened.close(); }
  });

  it('blocks dependency on a bare PTY exit, stale QA and failed QA; requires current QA plus approval', () => {
    const { store, project, agent, first, second } = fixture();
    addDependency(store, first.id, second.id);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('blocked');
    expect(() => reserveCardSession(store, { cardId: second.id, agentId: agent.id })).toThrow('Vorgänger');
    const run = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    expect(cardRunGate(store, second.id).dependency?.status).toBe('blocked');
    store.finishSession(run.id, 'exited', 0);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('blocked');
    const boundary = addQa(store, first.id, project.id, 'passed', '2099-01-01T00:00:00.000Z', store.session(run.id).endedAt!);
    expect(() => approveCardDependency(store, { cardId: second.id, qaReportId: boundary, note: 'Same timestamp boundary' })).toThrow('aktueller');
    const stale = addQa(store, first.id, project.id, 'passed', '2000-01-01T00:00:00.000Z');
    const failed = addQa(store, first.id, project.id, 'failed', '2099-01-01T00:00:00.000Z');
    expect(() => approveCardDependency(store, { cardId: second.id, qaReportId: stale, note: 'Stale report' })).toThrow('aktueller');
    expect(() => approveCardDependency(store, { cardId: second.id, qaReportId: failed, note: 'Failed report' })).toThrow('bestandener');
    const passed = addQa(store, first.id, project.id, 'passed', '2099-01-01T00:00:00.000Z');
    expect(() => approveCardDependency(store, { cardId: second.id, qaReportId: passed, note: 'short' })).toThrow('10 bis 1000');
    const gate = approveCardDependency(store, { cardId: second.id, qaReportId: passed, note: 'Sichtprüfung und QA sind akzeptiert.' });
    expect(gate.dependency?.status).toBe('approved');
    expect(gate.canStart).toBe(true);
    for (let index = 0; index < 11; index += 1) addQa(store, first.id, project.id, 'passed', '2099-01-02T00:00:00.000Z');
    expect(cardRunGate(store, second.id).dependency?.reports).toHaveLength(10);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('approved');
    const contentRevision = () => (store.db.prepare('SELECT content_revision AS revision FROM cards WHERE id = ?').get(first.id) as { revision: number }).revision;
    const beforeMove = contentRevision();
    store.updateCard({ id: first.id, title: first.title });
    expect(contentRevision()).toBe(beforeMove);
    const nextColumn = store.snapshot(project.id).columns.find((column) => column.id !== first.columnId)!;
    store.moveCard({ id: first.id, columnId: nextColumn.id });
    expect(contentRevision()).toBe(beforeMove);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('approved');
    store.db.prepare('INSERT INTO card_acceptance_criteria (id, card_id, text, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), first.id, 'New criterion', 1, '2100-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');
    expect(contentRevision()).toBe(beforeMove + 1);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('blocked');
    store.db.prepare('UPDATE cards SET title = ? WHERE id = ?').run('Changed after QA', first.id);
    expect(contentRevision()).toBe(beforeMove + 2);
    store.close();
  });

  it('accepts a linked completed workflow result only while it is the latest run', () => {
    const { store, project, agent, first, second } = fixture();
    addDependency(store, first.id, second.id);
    const flow = store.createWorkflow({ projectId: project.id, name: 'Synthetic workflow', cardIds: [first.id], steps: [
      { id: randomUUID(), columnId: first.columnId, agentId: agent.id, requireApproval: false },
    ] });
    store.setWorkflowState(flow.id, 'running');
    store.ensureWorkflowProgress(flow.id, 0, [first.id]);
    const linked = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    store.beginWorkflowCard(flow.id, 0, first.id, linked.id);
    store.finishSession(linked.id, 'exited', 0);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('blocked');
    store.finishWorkflowCard(linked.id, true);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('workflow');
    const nextColumn = store.snapshot(project.id).columns.find((column) => column.id !== first.columnId)!;
    store.moveCard({ id: first.id, columnId: nextColumn.id });
    expect(cardRunGate(store, second.id).dependency?.status).toBe('workflow');
    const later = reserveCardSession(store, { cardId: first.id, agentId: agent.id });
    store.finishSession(later.id, 'failed', 1);
    expect(cardRunGate(store, second.id).dependency?.status).toBe('blocked');
    store.close();
  });
});
