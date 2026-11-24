# Contributing to Branchloom

Branchloom welcomes bug reports, design feedback, and pull requests. The current source is available under [PolyForm Noncommercial 1.0.0](LICENSE), which is not an OSI open-source license. Earlier MIT snapshots retain their original terms.

## Before opening a pull request

1. Open an issue for a substantial change so we can agree on its scope.
2. Keep changes focused and document the user flow and remaining limits.
3. Use code and assets that you have the right to contribute. Identify third-party material and its license in the pull request. Do not include API keys, private data, browser profiles, or real user content.
4. Run `npm run typecheck`, `npm test`, `npm run build`, `npm audit --audit-level=critical`, and `node scripts/check-public.mjs`. Explain any check you could not run.

## Rights review before merge

The maintainer intends to offer separate commercial licenses. GitHub's default contribution terms follow the repository license; they do not, by themselves, establish the additional commercial relicensing rights needed for that model. External pull requests therefore remain blocked from merge until the maintainer has verified the necessary rights from **every copyright holder** of the contribution. A checkbox in the pull request is not a signed contributor agreement.

Read [the rights-review process](docs/CONTRIBUTOR_RIGHTS.md) before submitting code. Do not post legal names, addresses, signatures, employment documents, or private agreements in a public pull request. The maintainer applies the `contribution-rights-verified` label only after recording the agreement outside this repository. The label is a review marker, not the agreement itself. New code or contributors added after verification require another review.

The maintainer accounts `mschr703` and `mschr703CODEX` are exempt from the automated external-contribution gate; their own rights still need to be kept in order. A pull request opened while the repository was MIT-licensed is assessed against the rights in force for that contribution, rather than assumed to be covered by a later agreement.
