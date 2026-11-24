# External contribution rights review

This is the project's **merge process**, not a contributor license agreement and not proof that a contributor has signed one. External code is not merged until the maintainer has a separate, recorded rights grant that supports both the public Branchloom license and a possible commercial license.

## What the maintainer verifies

- Every person or entity that owns copyright in the proposed code or assets is identified. An employee may need an employer's authorization or an entity agreement.
- The grant is nonexclusive: contributors keep ownership and may use their own work elsewhere. It must expressly allow the Branchloom rights holder to modify, distribute, transfer, and sublicense the contribution under noncommercial **and** commercial terms. Patent rights and third-party material need explicit treatment.
- The agreement identifies its parties and covered contributions, states how consent is recorded, and is stored privately. No signature, address, or private correspondence is committed to this public repository.
- The proposed contribution passes the normal code review, tests, and public-data scan. Rights clearance does not imply technical approval.

The [Harmony contributor-agreement templates](https://www.harmonyagreements.org/agreements) offer individual and entity license agreements. Their outbound-license **Option Five** addresses commercial and proprietary licensing while retaining an outbound license on the submission date. The template has choices about the actual parties, third-party works, governing law, and signature method; those choices need review before adoption. We will not present an unfinished template as a binding Branchloom agreement.

## Pull-request gate

`contribution-rights` runs on the trusted base branch for each pull request. It passes for the two owner accounts or for a pull request with the maintainer-controlled `contribution-rights-verified` label. For other pull requests it fails with a link to this process. Only the maintainer applies the label after checking and privately recording the relevant agreement. If the contribution changes, the maintainer rechecks the scope and removes the label until any new rights are cleared.

The gate does not read or execute fork code, does not collect signatures, and cannot decide whether a purported grant is legally sufficient. A maintainer must check the actual authors and rights holders, including coauthors and copied material. Older contributions made under the former MIT license are reviewed individually; a later license change does not retroactively change those grants.

The protected `main` branch requires this GitHub Actions check, the normal `verify` check, and one approving review. New pushes dismiss stale reviews and need approval from someone other than the last pusher. A repository Actions policy explicitly permits `pull_request_target` only for this workflow; the job runs the base branch's code with read-only permissions. Repository administrators can bypass branch protection, so the maintainer must still follow the rights review when merging manually. The label remains on a pull request after new commits; a reviewer must remove it until the changed contribution is covered by the recorded grant.
