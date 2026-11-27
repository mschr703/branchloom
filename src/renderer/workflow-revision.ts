import type { ReviewedPlan } from '../shared/plan-review';

const revisionPrefix = 'Branchloom workflow revision v1\nOriginal goal JSON: ';

function originalGoal(request: string): string {
  if (!request.startsWith(revisionPrefix)) return request;
  const line = request.slice(revisionPrefix.length).split('\n', 1)[0];
  try { const parsed: unknown = JSON.parse(line ?? ''); if (typeof parsed === 'string') return parsed; }
  catch { /* Older or malformed revisions remain ordinary user text. */ }
  return request;
}

/** A bounded follow-up request. The planner still runs read-only and saves only a review proposal. */
export function workflowRevisionRequest(plan: ReviewedPlan, feedback: string): string {
  const message = feedback.trim();
  if (!message || message.length > 2000 || /\0/.test(message)) throw new Error('Feedback muss 1 bis 2000 Zeichen enthalten.');
  const request = [
    `${revisionPrefix}${JSON.stringify(originalGoal(plan.request))}`,
    'Revise this workflow plan after the user feedback. Keep the goal, but reconsider the cards and route. This is a proposal only.',
    `Current proposal: ${JSON.stringify(plan.proposal)}`,
    `User feedback: ${message}`,
  ].join('\n\n');
  if (request.length > 8000) throw new Error('Plan und Feedback sind zusammen zu lang. Formuliere einen kürzeren neuen Auftrag.');
  return request;
}
