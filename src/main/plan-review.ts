import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Workflow } from '../shared/types';
import { planLines, type PlanComment, type ReviewedPlan } from '../shared/plan-review';
import type { StudioStore } from './store';
import { validateWorkflowProposal } from './workflow-proposal';

type PlanRow = { id: string; project_id: string; request: string; proposal_json: string; fingerprint: string; state: ReviewedPlan['state']; workflow_id: string | null; created_at: string };
type CommentRow = { id: string; plan_id: string; fingerprint: string; line: number; text: string; body: string; created_at: string };

export function installPlanReview(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviewed_plans (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      request TEXT NOT NULL, proposal_json TEXT NOT NULL, fingerprint TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('open','superseded','accepted')),
      workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviewed_plans_project ON reviewed_plans(project_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS plan_comments (
      id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES reviewed_plans(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, line INTEGER NOT NULL CHECK(line > 0),
      text TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plan_comments_plan ON plan_comments(plan_id, created_at);
  `);
}

const planOf = (row: PlanRow): ReviewedPlan => ({ id: row.id, projectId: row.project_id, request: row.request,
  proposal: JSON.parse(row.proposal_json) as ReviewedPlan['proposal'], fingerprint: row.fingerprint,
  state: row.state, workflowId: row.workflow_id, createdAt: row.created_at });
const commentOf = (row: CommentRow): PlanComment => ({ id: row.id, planId: row.plan_id,
  fingerprint: row.fingerprint, line: row.line, text: row.text, body: row.body, createdAt: row.created_at });

export function reviewedPlan(store: StudioStore, id: string): ReviewedPlan {
  const row = store.db.prepare('SELECT * FROM reviewed_plans WHERE id = ?').get(id) as PlanRow | undefined;
  if (!row) throw new Error('Planentwurf nicht gefunden.');
  return planOf(row);
}

export function listReviewedPlans(store: StudioStore, projectId: string): ReviewedPlan[] {
  store.project(projectId);
  return (store.db.prepare('SELECT * FROM reviewed_plans WHERE project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30').all(projectId) as PlanRow[]).map(planOf);
}

export function saveReviewedPlan(store: StudioStore, input: { projectId: string; request: string; proposal: ReviewedPlan['proposal'] }): ReviewedPlan {
  const snapshot = store.snapshot(input.projectId);
  if (typeof input.request !== 'string' || !input.request.trim() || input.request.length > 8000 || /\0/.test(input.request)) throw new Error('Ungültiger Planauftrag.');
  const proposal = validateWorkflowProposal(input.proposal, snapshot.columns);
  if (planLines(proposal).length > 500) throw new Error('Der Vorschlag hat mehr als 500 Review-Zeilen. Bitte kleiner planen.');
  const fingerprint = createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
  const id = randomUUID();
  store.db.transaction(() => {
    store.db.prepare("UPDATE reviewed_plans SET state = 'superseded' WHERE project_id = ? AND state = 'open'").run(input.projectId);
    store.db.prepare("INSERT INTO reviewed_plans (id, project_id, request, proposal_json, fingerprint, state, workflow_id, created_at) VALUES (?, ?, ?, ?, ?, 'open', NULL, ?)")
      .run(id, input.projectId, input.request.trim(), JSON.stringify(proposal), fingerprint, new Date().toISOString());
  })();
  return reviewedPlan(store, id);
}

/** Editing creates a new review revision so old comments retain their exact source lines. */
export function reviseReviewedPlan(store: StudioStore, input: { planId: string; fingerprint: string; proposal: ReviewedPlan['proposal'] }): ReviewedPlan {
  const previous = reviewedPlan(store, input.planId);
  if (previous.state !== 'open' || previous.fingerprint !== input.fingerprint) throw new Error('Der Plan ist veraltet oder bereits übernommen. Bitte neu laden.');
  return saveReviewedPlan(store, { projectId: previous.projectId, request: previous.request, proposal: input.proposal });
}

export function listPlanComments(store: StudioStore, planId: string): PlanComment[] {
  reviewedPlan(store, planId);
  return (store.db.prepare('SELECT * FROM plan_comments WHERE plan_id = ? ORDER BY created_at, rowid LIMIT 101').all(planId) as CommentRow[]).map(commentOf);
}

export function createPlanComment(store: StudioStore, input: { planId: string; fingerprint: string; line: number; body: string }): PlanComment {
  const plan = reviewedPlan(store, input.planId);
  if (plan.state !== 'open') throw new Error('Dieser Plan ist nicht mehr zur Kommentierung offen.');
  if (plan.fingerprint !== input.fingerprint) throw new Error('Der Plan hat sich seit der Vorschau geändert. Bitte neu laden.');
  if (typeof input.line !== 'number' || !Number.isSafeInteger(input.line)) throw new Error('Ungültige Planzeile.');
  const line = planLines(plan.proposal).find((item) => item.number === input.line);
  if (!line) throw new Error('Planzeile nicht gefunden.');
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > 2000 || /\0/.test(input.body)) throw new Error('Kommentar muss 1 bis 2000 Zeichen enthalten.');
  const count = store.db.prepare('SELECT COUNT(*) AS count FROM plan_comments WHERE plan_id = ?').get(plan.id) as { count: number };
  if (count.count >= 100) throw new Error('Maximal 100 Kommentare pro Plan.');
  const id = randomUUID();
  store.db.prepare('INSERT INTO plan_comments (id, plan_id, fingerprint, line, text, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, plan.id, plan.fingerprint, line.number, line.text, input.body.trim(), new Date().toISOString());
  return commentOf(store.db.prepare('SELECT * FROM plan_comments WHERE id = ?').get(id) as CommentRow);
}

export function acceptReviewedPlan(store: StudioStore, input: { planId: string; fingerprint: string }): Workflow {
  return store.db.transaction(() => {
    const plan = reviewedPlan(store, input.planId);
    if (plan.state !== 'open' || plan.fingerprint !== input.fingerprint) throw new Error('Der Plan ist veraltet oder bereits übernommen. Bitte neu laden.');
    if (store.projectQueue(plan.projectId).state === 'running') throw new Error('Warteschlange vor der Planübernahme pausieren.');
    const workflow = store.acceptWorkflowProposal({ projectId: plan.projectId, proposal: plan.proposal });
    store.db.prepare("UPDATE reviewed_plans SET state = 'accepted', workflow_id = ? WHERE id = ? AND state = 'open'").run(workflow.id, plan.id);
    return workflow;
  })();
}
