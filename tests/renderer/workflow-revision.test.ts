import { describe, expect, it } from 'vitest';
import { workflowRevisionRequest } from '../../src/renderer/workflow-revision';
import type { ReviewedPlan } from '../../src/shared/plan-review';

const plan: ReviewedPlan = {
  id: 'plan', projectId: 'project', request: 'Build a settings screen', fingerprint: 'fingerprint',
  state: 'open', workflowId: null, createdAt: '2026-11-27T00:00:00Z',
  proposal: { title: 'Settings', explanation: 'A first route', cards: [{ title: 'Settings form', description: 'Implement form' }], columnIds: ['planning'] },
};

describe('workflow revision request', () => {
  it('keeps the original goal, exact current proposal, and user feedback in a bounded new request', () => {
    const request = workflowRevisionRequest(plan, 'Please add keyboard checks.');
    expect(request).toContain('Build a settings screen');
    expect(request).toContain('Settings form');
    expect(request).toContain('Please add keyboard checks.');
    expect(request.length).toBeLessThan(8000);
    expect(workflowRevisionRequest({ ...plan, request, proposal: { ...plan.proposal, title: 'Second version' } }, 'Now add contrast checks.'))
      .toContain('Original goal JSON: "Build a settings screen"');
  });

  it('rejects empty and excessive feedback or an oversized combined request', () => {
    expect(() => workflowRevisionRequest(plan, '  ')).toThrow('Feedback');
    expect(() => workflowRevisionRequest(plan, 'x'.repeat(2001))).toThrow('Feedback');
    expect(() => workflowRevisionRequest({ ...plan, request: 'x'.repeat(7900) }, 'Extra')).toThrow('zu lang');
  });
});
