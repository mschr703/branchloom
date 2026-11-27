import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { acceptReviewedPlan, createPlanComment, listPlanComments, listReviewedPlans, reviseReviewedPlan, saveReviewedPlan } from '../../src/main/plan-review';
import { planFeedback, planLines } from '../../src/shared/plan-review';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-plan-review-test-'));
  roots.push(root);
  const file = join(root, 'studio.sqlite');
  const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic project', path: root });
  const columns = store.snapshot(project.id).columns;
  const input = { projectId: project.id, request: 'Build a small feature', proposal: {
    title: 'Reviewable workflow', explanation: 'First inspect.\nThen test.',
    cards: [{ title: 'Implement', description: 'Change code.\nKeep tests.' }], columnIds: [columns[1]!.id, columns[4]!.id],
  } };
  return { store, file, project, input };
}

describe('persisted workflow plan review', () => {
  it('keeps a numbered comment and exact proposal across SQLite restart, then accepts once', () => {
    const { store, file, project, input } = setup();
    const plan = saveReviewedPlan(store, input);
    expect(planLines(plan.proposal).map((line) => line.text)).toEqual([
      'Titel: Reviewable workflow', 'Begründung:', 'First inspect.', 'Then test.',
      'Karte 1: Implement', 'Change code.', 'Keep tests.', `Route: ${input.proposal.columnIds.join(' → ')}`,
    ]);
    const comment = createPlanComment(store, { planId: plan.id, fingerprint: plan.fingerprint, line: 6, body: '  Check error handling.  ' });
    expect(comment.text).toBe('Change code.');
    expect(comment.body).toBe('Check error handling.');
    expect(planFeedback(plan, [comment])).toContain('Zeile 6 (Change code.): Check error handling.');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    store.close();

    const reopened = new StudioStore(file);
    expect(listReviewedPlans(reopened, project.id)[0]).toEqual(plan);
    expect(listPlanComments(reopened, plan.id)).toEqual([comment]);
    const workflow = acceptReviewedPlan(reopened, { planId: plan.id, fingerprint: plan.fingerprint });
    expect(workflow.state).toBe('draft');
    expect(reopened.snapshot(project.id).cards).toHaveLength(1);
    expect(listReviewedPlans(reopened, project.id)[0]?.workflowId).toBe(workflow.id);
    expect(() => acceptReviewedPlan(reopened, { planId: plan.id, fingerprint: plan.fingerprint })).toThrow('veraltet oder bereits übernommen');
    expect(reopened.snapshot(project.id).cards).toHaveLength(1);
    expect(() => createPlanComment(reopened, { planId: plan.id, fingerprint: plan.fingerprint, line: 6, body: 'Too late' })).toThrow('nicht mehr');
    reopened.close();
  });

  it('rejects forged and stale anchors, preserving older comments when a new plan arrives', () => {
    const { store, project, input } = setup();
    const first = saveReviewedPlan(store, input);
    expect(() => createPlanComment(store, { planId: first.id, fingerprint: 'forged', line: 1, body: 'X' })).toThrow('geändert');
    expect(() => createPlanComment(store, { planId: first.id, fingerprint: first.fingerprint, line: 100, body: 'X' })).toThrow('nicht gefunden');
    const older = createPlanComment(store, { planId: first.id, fingerprint: first.fingerprint, line: 1, body: 'Clarify scope' });
    const second = saveReviewedPlan(store, { ...input, proposal: { ...input.proposal, title: 'Second plan' } });
    expect(listReviewedPlans(store, project.id).map((plan) => plan.state)).toEqual(['open', 'superseded']);
    expect(listPlanComments(store, first.id)).toEqual([older]);
    expect(() => acceptReviewedPlan(store, { planId: first.id, fingerprint: first.fingerprint })).toThrow('veraltet');
    expect(() => acceptReviewedPlan(store, { planId: second.id, fingerprint: first.fingerprint })).toThrow('veraltet');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    store.close();
  });

  it('saves an edited proposal as a new review revision without creating cards or moving old comments', () => {
    const { store, project, input } = setup();
    const first = saveReviewedPlan(store, input);
    const comment = createPlanComment(store, { planId: first.id, fingerprint: first.fingerprint, line: 1, body: 'Shorten the name' });
    const edited = reviseReviewedPlan(store, { planId: first.id, fingerprint: first.fingerprint,
      proposal: { ...input.proposal, title: 'Edited workflow', cards: [{ title: 'Implement carefully', description: 'Keep tests.' }] } });
    expect(edited.id).not.toBe(first.id);
    expect(edited.proposal.title).toBe('Edited workflow');
    expect(listReviewedPlans(store, project.id).map((plan) => plan.state)).toEqual(['open', 'superseded']);
    expect(listPlanComments(store, first.id)).toEqual([comment]);
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    expect(() => reviseReviewedPlan(store, { planId: first.id, fingerprint: first.fingerprint, proposal: input.proposal })).toThrow('veraltet');
    expect(() => reviseReviewedPlan(store, { planId: edited.id, fingerprint: 'forged', proposal: input.proposal })).toThrow('veraltet');
    const accepted = acceptReviewedPlan(store, { planId: edited.id, fingerprint: edited.fingerprint });
    expect(accepted.state).toBe('draft');
    expect(store.snapshot(project.id).cards.map((card) => card.title)).toEqual(['Implement carefully']);
    store.close();
  });

  it('rechecks columns during acceptance and rolls back plan state and cards on failure', () => {
    const { store, project, input } = setup();
    const plan = saveReviewedPlan(store, input);
    const removed = input.proposal.columnIds[1]!;
    store.deleteColumn(removed);
    expect(() => acceptReviewedPlan(store, { planId: plan.id, fingerprint: plan.fingerprint })).toThrow();
    expect(listReviewedPlans(store, project.id)[0]?.state).toBe('open');
    expect(store.snapshot(project.id).cards).toHaveLength(0);
    store.close();
  });

  it('does not add To-Do cards while the automatic queue is running', () => {
    const { store, project, input } = setup();
    const plan = saveReviewedPlan(store, input);
    const templateCard = store.createCard({ projectId: project.id, columnId: store.snapshot(project.id).columns[0]!.id, title: 'Template' });
    const template = store.createWorkflow({ projectId: project.id, name: 'Template', cardIds: [templateCard.id],
      steps: [{ id: 'step', columnId: input.proposal.columnIds[0]!, agentId: null, requireApproval: true }] });
    store.saveProjectQueue({ projectId: project.id, state: 'running', templateWorkflowId: template.id, activeWorkflowId: null, pauseReason: null });
    expect(() => acceptReviewedPlan(store, { planId: plan.id, fingerprint: plan.fingerprint })).toThrow('Warteschlange');
    expect(store.snapshot(project.id).cards).toHaveLength(1);
    expect(listReviewedPlans(store, project.id)[0]?.state).toBe('open');
    store.close();
  });
});
