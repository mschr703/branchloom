import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const trustedOwners = new Set(['mschr703', 'mschr703codex']);
const clearanceLabel = 'contribution-rights-verified';

export function evaluateContributionRights(event) {
  const author = event?.pull_request?.user?.login;
  if (typeof author !== 'string' || !author) throw new Error('A pull request author is required.');
  if (trustedOwners.has(author.toLowerCase())) return { allowed: true, reason: 'Owner account' };
  const labels = event.pull_request.labels;
  if (!Array.isArray(labels)) throw new Error('Pull request labels are required.');
  if (labels.some((label) => label?.name === clearanceLabel)) return { allowed: true, reason: 'Maintainer rights clearance' };
  return { allowed: false, reason: `External contribution from ${author} requires maintainer rights clearance: https://github.com/mschr703/branchloom/blob/main/docs/CONTRIBUTOR_RIGHTS.md` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required.');
  const result = evaluateContributionRights(JSON.parse(readFileSync(eventPath, 'utf8')));
  console.log(result.reason);
  if (!result.allowed) process.exitCode = 1;
}
