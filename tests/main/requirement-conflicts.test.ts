import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioStore } from '../../src/main/store';
import { cardCriteria, createCardCriterion, updateCardCriterion } from '../../src/main/card-acceptance';
import { addRequirementClaim, refreshRequirementClaim, removeRequirementClaim, requirementConflictBoard, resolveRequirementConflict } from '../../src/main/requirement-conflicts';
import { cardRequirementView } from '../../src/shared/requirement-conflicts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) {
  try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
} });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'branchloom-rules-')); roots.push(root);
  const path = join(root, 'project'); mkdirSync(path);
  const file = join(root, 'studio.sqlite'); const store = new StudioStore(file);
  const project = store.createProject({ name: 'Synthetic rules', path });
  const columnId = store.snapshot(project.id).columns[0]!.id;
  const first = store.createCard({ projectId: project.id, columnId, title: 'Frontend navigation' });
  const second = store.createCard({ projectId: project.id, columnId, title: 'Backend navigation' });
  const a = createCardCriterion(store, { cardId: first.id, text: 'Navigation is always visible at widths up to 768 px.' })[0]!;
  const b = createCardCriterion(store, { cardId: second.id, text: 'Navigation is hidden at widths up to 768 px.' })[0]!;
  return { root, file, store, project, first, second, a, b };
}
function add(store: StudioStore, projectId: string, cardId: string, criterionId: string, stance: 'required' | 'forbidden', scope = 'Width up to 768 px', property = 'Navigation visibility') {
  const current = requirementConflictBoard(store, projectId);
  return addRequirementClaim(store, { projectId, cardId, criterionId, component: 'Navigation', scope, property, stance, expectedCardRevision: current.cardRevisions[cardId]! });
}

describe('explicit requirement conflicts', () => {
  it('shows opposite source statements with exact cards and keeps the chosen decision after restart', () => {
    const { file, store, project, first, second, a, b } = fixture();
    add(store, project.id, first.id, a.id, 'required');
    const board = add(store, project.id, second.id, b.id, 'forbidden', 'width  UP TO 768 PX');
    expect(board.conflicts).toHaveLength(1);
    const conflict = board.conflicts[0]!;
    expect([conflict.left.statement, conflict.right.statement].sort()).toEqual([a.text, b.text].sort());
    expect([conflict.left.cardId, conflict.right.cardId].sort()).toEqual([first.id, second.id].sort());
    expect(conflict.current).toBe(true);
    const decided = resolveRequirementConflict(store, { projectId: project.id, pairKey: conflict.pairKey, fingerprint: conflict.fingerprint,
      status: 'chosen', winnerClaimId: conflict.left.id, reason: 'The product brief requires a visible mobile navigation.' });
    expect(decided.conflicts[0]?.decision).toMatchObject({ status: 'chosen', current: true, winnerClaimId: conflict.left.id });
    expect(cardCriteria(store, first.id)[0]?.text).toBe(a.text);
    expect(cardCriteria(store, second.id)[0]?.text).toBe(b.text);
    store.close();
    const reopened = new StudioStore(file);
    try {
      const after = requirementConflictBoard(reopened, project.id);
      expect(after.conflicts[0]?.decision?.reason).toContain('visible mobile');
      expect([after.decisionHistory[0]?.leftCardId, after.decisionHistory[0]?.rightCardId].sort()).toEqual([first.id, second.id].sort());
      expect([after.decisionHistory[0]?.leftStatement, after.decisionHistory[0]?.rightStatement].sort()).toEqual([a.text, b.text].sort());
      expect(cardRequirementView(after, first.id).history[0]?.id).toBe(after.decisionHistory[0]?.id);
      expect(cardRequirementView(after, second.id).history[0]?.id).toBe(after.decisionHistory[0]?.id);
    } finally { reopened.close(); }
  });

  it('does not equate similar titles, different scope or property, or matching stances', () => {
    const { store, project, first, second, a, b } = fixture();
    add(store, project.id, first.id, a.id, 'required');
    expect(add(store, project.id, second.id, b.id, 'forbidden', 'Desktop only').conflicts).toHaveLength(0);
    const third = store.createCard({ projectId: project.id, columnId: first.columnId, title: first.title });
    const c = createCardCriterion(store, { cardId: third.id, text: 'Navigation is visible on mobile.' })[0]!;
    expect(add(store, project.id, third.id, c.id, 'required').conflicts).toHaveLength(0);
    const fourth = store.createCard({ projectId: project.id, columnId: first.columnId, title: first.title });
    const d = createCardCriterion(store, { cardId: fourth.id, text: 'Navigation is hidden on mobile.' })[0]!;
    expect(add(store, project.id, fourth.id, d.id, 'forbidden', 'Width up to 768 px', 'Animation').conflicts).toHaveLength(0);
    store.close();
  });

  it('rejects decisions on changed sources and keeps old decisions historical after refresh', () => {
    const { store, project, first, second, a, b } = fixture();
    add(store, project.id, first.id, a.id, 'required');
    const board = add(store, project.id, second.id, b.id, 'forbidden');
    const conflict = board.conflicts[0]!;
    updateCardCriterion(store, { cardId: second.id, criterionId: b.id, text: 'Navigation is absent at widths up to 768 px.' });
    const stale = requirementConflictBoard(store, project.id);
    expect(stale.conflicts[0]?.current).toBe(false);
    expect(() => resolveRequirementConflict(store, { projectId: project.id, pairKey: conflict.pairKey, fingerprint: conflict.fingerprint,
      status: 'chosen', winnerClaimId: conflict.left.id, reason: 'Old source' })).toThrow('changed');
    const sourceClaim = stale.claims.find((claim) => claim.cardId === second.id)!;
    const refreshed = refreshRequirementClaim(store, { projectId: project.id, claimId: sourceClaim.id, expectedCardRevision: stale.cardRevisions[second.id]! });
    expect(refreshed.conflicts[0]?.current).toBe(true);
    const current = refreshed.conflicts[0]!;
    resolveRequirementConflict(store, { projectId: project.id, pairKey: current.pairKey, fingerprint: current.fingerprint,
      status: 'dismissed', reason: 'One statement refers to the drawer, not the main navigation.' });
    store.updateCard({ id: first.id, title: 'Frontend navigation revised' });
    const after = requirementConflictBoard(store, project.id);
    expect(after.conflicts[0]?.current).toBe(false);
    expect(after.decisionHistory[0]?.current).toBe(false);
    expect(after.decisionHistory[0]?.reason).toContain('drawer');
    store.close();
  });

  it('rejects cross-project or duplicate classifications and preserves a dismissal after a rule is removed', () => {
    const { root, store, project, first, second, a, b } = fixture();
    add(store, project.id, first.id, a.id, 'required');
    expect(() => add(store, project.id, first.id, a.id, 'forbidden')).toThrow('already');
    const otherPath = join(root, 'other'); mkdirSync(otherPath);
    const other = store.createProject({ name: 'Other', path: otherPath });
    expect(() => addRequirementClaim(store, { projectId: other.id, cardId: first.id, criterionId: a.id, component: 'Navigation', scope: 'Mobile', property: 'Visible', stance: 'required', expectedCardRevision: 1 })).toThrow('outside');
    const pair = add(store, project.id, second.id, b.id, 'forbidden').conflicts[0]!;
    expect(() => resolveRequirementConflict(store, { projectId: project.id, pairKey: pair.pairKey, fingerprint: pair.fingerprint, status: 'chosen', winnerClaimId: 'not-a-claim', reason: 'No' })).toThrow('Choose one');
    resolveRequirementConflict(store, { projectId: project.id, pairKey: pair.pairKey, fingerprint: pair.fingerprint, status: 'dismissed', reason: 'Different contexts.' });
    const after = removeRequirementClaim(store, { projectId: project.id, claimId: pair.left.id });
    expect(after.conflicts).toHaveLength(0);
    expect(after.decisionHistory[0]).toMatchObject({ status: 'dismissed', current: false, reason: 'Different contexts.' });
    store.close();
  });
});
