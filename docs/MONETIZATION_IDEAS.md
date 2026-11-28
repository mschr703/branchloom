# Branchloom business model · working ideas

This is a decision list, not a price sheet or a statement that billing exists. The product should remain useful for one person and for a team using its own computers. The first paid value is an always-available hosted team workspace, not a fee for moving a local card.

## Product boundary

| Mode | User value | Candidate business boundary |
| --- | --- | --- |
| Local personal | Plan, run an installed agent, inspect and review work on one computer | Core product; no Branchloom hosting account required. |
| Local team | Invite a colleague and collaborate while an owner device is online, using a secure local connection | No Branchloom hosting subscription. The preview offers Tailscale or a manually configured LAN HTTPS proxy; simple pairing and each member's own agent worker remain open. Commercial-use licensing remains a separate decision. |
| Managed team | Shared plan, presence, decisions and history remain available when member laptops are off | Workspace subscription for hosting, sync, backups and operations. An agent still needs an online authorized worker. |
| Customer-hosted | A team runs its own coordinator on a VPS or homelab server | Deployment and support terms to decide; do not force customer data through Branchloom hosting. |

The public desktop core should expose the same documented collaboration protocol to every deployment mode. Hosting operations, billing and optional managed workers can be separate services. This boundary is a proposal, not a commitment to close any particular source file. A future private feature must not make exported local project data unusable or silently alter access rights.

## Revenue options to test

| Priority | Option | Reason someone would pay | What to validate first |
| --- | --- | --- | --- |
| 1 | Managed team workspace | A shared board, plan and conversation remain reachable from anywhere without running a member laptop. | Hosting cost per workspace, backup/restore, two-device reliability and willingness to pay. |
| 1 | Active editor seats | Teams need clear permissions and shared editing; read-only reviewers may be invited often. | Whether a simple workspace price is easier to understand than seats; avoid charging for every viewer by default. |
| 2 | Managed agent worker | Night runs continue after laptops are off, using team-owned model access. | Metered compute, job isolation, spend caps, provider terms and a complete audit trail. Model/provider fees must be shown separately. |
| 2 | Hosted visual QA capacity | Scheduled browser replay, screenshots and visual comparisons can consume storage and compute. | Measured cost per run and retention; keep basic local review usable. |
| 3 | Organization controls | Larger teams need SSO, role policy, audit export, retention and administrative recovery. | Actual customer demand and the security implementation needed for each control. |
| 3 | Managed backup and longer history | Teams may value point-in-time recovery, longer decision history and project migration. | Restore drills and whether this belongs in the base hosted plan rather than a confusing add-on. |
| 3 | Customer-hosted support | Some organizations need their own VPS but want installation, updates and incident help. | Support effort, deployment repeatability and a clear commercial license. |
| 4 | Setup and migration service | Moving an existing board, workflow and team conventions into Branchloom takes work. | A repeatable service package, explicit data scope and real demand. |
| 4 | Verified workflow/template marketplace | Specialists could sell reviewed templates or integrations once there is an ecosystem. | Quality, trust, maintenance and demand; do not build a marketplace before real usage. |
| 4 | Private integrations | Organizations may need a connector or policy adapter that the general desktop product does not need. | Reusability, ongoing maintenance and whether the connector can instead be public. |

The recommended first offer is one managed workspace plan with a visible limit, plus an optional separately metered worker. Add further tiers only after real teams use the local collaboration flow. Avoid charging users again for their existing CLI subscription or implying that a personal CLI login can be moved to a server.

## Open decisions

1. Test two physical devices, ordinary LAN and Tailscale, then observe which setup people can complete without help.
2. Decide whether hosted billing is per workspace, active editor or a hybrid after measuring storage and support cost. Keep guest/reviewer access understandable.
3. Define hosted data export and migration to and from customer-hosted deployments before selling a subscription.
4. Decide the public/private code boundary per module. Security-critical client protocol and local data formats should remain reviewable. A paid service can be implemented separately; no existing public right can be withdrawn retroactively.
5. Review the current [commercial licensing](COMMERCIAL_LICENSING.md) before advertising free local use to businesses. [PolyForm Noncommercial](https://polyformproject.org/licenses/noncommercial/1.0.0) restricts permitted use to noncommercial purposes, while the [Open Source Definition](https://opensource.org/osd) does not allow field-of-use restrictions. The present repository is therefore source-available rather than OSI-approved open source.
6. Choose prices, trial, payment provider, taxes and contractual terms only after the technical acceptance and cost measurements. No checkout or entitlement enforcement is implemented today.

See [team hosting plan](TEAM_HOSTING.md), [team sync plan](TEAM_SYNC.md) and [current status](STATUS.md) for the actual implementation boundary.
