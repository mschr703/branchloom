import { describe, expect, it } from 'vitest';
import { evaluateContributionRights } from '../../scripts/check-contribution-rights.mjs';

function pullRequest(author: string, labels: string[] = []) {
  return { pull_request: { user: { login: author }, labels: labels.map((name) => ({ name })) } };
}

describe('contribution rights merge gate', () => {
  it('permits only the two owner accounts without manual clearance', () => {
    expect(evaluateContributionRights(pullRequest('mschr703')).allowed).toBe(true);
    expect(evaluateContributionRights(pullRequest('mschr703CODEX')).allowed).toBe(true);
    expect(evaluateContributionRights(pullRequest('external-collaborator')).allowed).toBe(false);
  });

  it('requires the exact maintainer clearance label for an external author', () => {
    expect(evaluateContributionRights(pullRequest('contributor', ['rights-reviewed'])).allowed).toBe(false);
    expect(evaluateContributionRights(pullRequest('contributor', ['contribution-rights-verified'])).allowed).toBe(true);
  });

  it('fails closed when the pull request payload is incomplete', () => {
    expect(() => evaluateContributionRights({})).toThrow('author');
    expect(() => evaluateContributionRights({ pull_request: { user: { login: 'external' } } })).toThrow('labels');
  });
});
