# Hosted team workspaces · implementation boundary

The product direction is a paid team mode hosted on the project's VPS: members join a shared workspace, plan and edit together, and bring their own authorized agents. This document is a build plan, not an offer or a claim that billing or a remote team service is live. The present desktop coordinator is a loopback-only preview described in [TEAM_SYNC.md](TEAM_SYNC.md).

## Deployment modes

| Mode | Coordinator | Current state |
| --- | --- | --- |
| Local preview | This desktop app, bound to `127.0.0.1` | Implemented for local testing. It stops when the host app stops. |
| Managed team | Separate service on the operator's VPS behind HTTPS | Planned paid offer. It must work when all members' laptops are off. |
| Customer-hosted team | Customer's own VPS/server behind HTTPS | Requested earlier; licensing and support terms remain a product decision. |

The client already accepts a saved HTTPS coordinator origin, but there is no deployable standalone coordinator yet. `teamCoordinatorTransport` classifies a validated connection from its URL. The local service now resumes and manages only loopback connections. An HTTPS owner connection cannot silently start a local coordinator or mutate a local workspace as if it were the remote canonical workspace. This is a safety boundary, not remote hosting support.

## Service split

1. Extract the coordinator from Electron into a separately runnable service with its own durable database, migrations, health checks, backup and restore, and structured operational logs. Keep its HTTP listener on loopback or a private interface; a configured reverse proxy terminates HTTPS. The current `TeamCoordinatorHttp` must **not** be exposed directly to the public internet.
2. Move canonical team workspaces, memberships, project boards, accepted plans, revisioned commands, event cursors, and collaborative documents to that service. The desktop app remains a client and optional agent worker. A locally opened project is not automatically uploaded; migration needs a preview of data and an explicit choice.
3. Authenticate each person as a distinct account. Invitations are scoped, expiring, single-use and revocable. Member identity is separate from team and project roles. Every read and write rechecks the workspace, project, member and capability on the server. A display name or AI response never grants access.
4. Keep personal CLI credentials on each member's worker. A future server worker uses team-owned model credentials stored on the server with separate access controls. The coordinator dispatches authorized jobs; it does not infer permission from chat text.

## Paid entitlement boundary

The managed service, not the desktop UI, will be authoritative for team entitlements. The intended contract is a server-side workspace entitlement with plan identifier, enabled capabilities, seat limit, billing state and effective period. A verified billing event updates that record idempotently; requests that create members, start paid workers or use paid collaboration check the current entitlement in the same service that enforces member permissions. Clients receive a typed capability/status response for display and a recovery action. A UI flag alone cannot grant a paid capability.

No payment provider, price, trial length, grace period, or seat policy is selected yet. There is no checkout, subscription enforcement or paywall in the current app. The local preview stays usable while the managed service is built; a later pricing decision must say which local or customer-hosted capabilities remain available. Source code and saved credentials must never be bundled into a billing event.

## First hosted acceptance path

1. Start the standalone coordinator on a VPS behind HTTPS with a fresh database, then create one workspace and invite two distinct accounts. Verify one shared canonical project on two computers.
2. Edit the same card draft concurrently, disconnect one client, reconnect, and confirm both accepted edits survive a service restart. Presence expires when a client disappears.
3. Move a card through a revisioned command. A stale revision returns a visible conflict; a repeated mutation ID does not duplicate an agent run.
4. Turn the owner's laptop off. The second member can still view, plan and edit. A worker job runs only when a permitted worker is online or an explicitly configured server worker is available.
5. Revoke a member and verify current streams, saved credentials, reconnects and write attempts lose access. Exercise expired and insufficient entitlements separately from project permission failures.
6. Test backups, restore, database migration, TLS failure, outage and reconnect without losing accepted commands or replaying one twice.

Related plan: [TEAM_SYNC.md](TEAM_SYNC.md). The collaborative idea-to-plan workflow needs the joint product discussion requested by the user before its detailed interaction is fixed.
