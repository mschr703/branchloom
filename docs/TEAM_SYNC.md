# Team synchronization design

This is the implementation direction for the first real team release. It describes intended behavior, not a shipped service. The [current guest board](TEAM_BOARD.md) remains a short-lived view hosted by one running desktop app.

## The first useful team session

1. An owner creates a team workspace and a project, then invites a colleague. The workspace owns the project; the colleague has a team role and any narrower project rights.
2. Both open the same card. They see each other's presence and text edits as they happen. Both can open the same Whiteboard area and move or edit different objects without replacing the entire board. An overlapping edit is merged where the data type supports it; a conflicting business action is shown as a conflict.
3. The dashboard answers **What needs my decision now?** It links to the exact card, diagram area, question, or review. A shared AI conversation may draft an answer or plan, but only an authorized member can apply the proposal.
4. The second member can keep planning when the owner's laptop is off if the workspace coordinator runs on a self-hosted server or a future managed service. A laptop-hosted workspace is available only while that laptop is online.

This release focuses on collaborative planning and the dashboard. A permanent server agent worker and managed billing follow later. Agent workers can initially run on members' laptops; no personal CLI credential is copied to the coordinator.

## One project, several views

The card has one stable project identity. Kanban, Whiteboard, Decision Inbox, and chat references point to it; they do not each create a second card record. A Whiteboard sketch can also contain free notes and connectors that are not tasks. Promoting a draft element to a task is an explicit, reviewable action with a stable link back to the sketch.

The board column and card status are authoritative business state. A visual edit to a diagram or free text cannot silently move a card, start an agent, approve a plan, or merge code.

## Drafts, team roles, and approvals

Several members may edit the same draft. AI feedback can revise that draft and point out ambiguity; agreeing with the AI does not make the draft an accepted team plan. Promotion creates or changes authoritative cards, dependencies, or approved diagram elements only through a separate, revisioned command. The proposal shows exactly what will change, who requested it, and any conflicting edits made since it was prepared. Members who are viewing the same area see a pending proposal, not a silent board mutation.

Team role, project access, and project approval mode are separate. A developer may edit assigned work and participate in drafts without gaining the right to accept a plan, start a broadly privileged agent, or integrate code. A project can grant selected members more authority explicitly. A `full access` mode is an owner-controlled project policy with a visible scope and audit trail, not a property inferred from a chat reply or a model decision. The user chose that project admins may accept a discussed draft directly; normal members submit it for confirmation by a project admin. The pending request remains visible with its source and proposed effects. Approval must recheck the current revision so a stale preview cannot overwrite later team work. Until this separate approval command exists, the coordinator must not treat draft editing or AI agreement as approval.

The first implementation should represent these as named capabilities rather than assuming every `editor` can do every project action: read, edit draft, propose plan, accept plan, manage task, start agent, review, integrate, and manage members. Some capabilities can be granted per project, subject to the owner’s policy. A permission change is itself a revisioned owner action and must take effect for existing sessions and reconnecting clients.

## Proposed service boundary

- A coordinator owns workspace membership, project ACLs, canonical task IDs, business revisions, the event feed, and persistent collaboration documents. Its protocol is the same whether it runs on a laptop, a user-provided VPS/homelab server, or a later managed service.
- The desktop app is a client and an optional agent worker. A worker advertises capabilities and receives only project-scoped jobs that the coordinator has authorized. A server worker, if enabled later, uses its own team model credentials.
- Live text and diagram drafts need concurrent editing. Yjs is a candidate for this document layer; Hocuspocus offers authentication and storage hooks. Persist the Yjs binary document, not a JSON reconstruction of it. Presence/cursors are transient and must not be mistaken for durable edits. The exact editor binding and server package are subject to a small integration spike and license review before adoption. [Yjs license](https://github.com/yjs/yjs/blob/main/LICENSE) · [Hocuspocus authentication](https://tiptap.dev/docs/hocuspocus/guides/authentication) · [persistence guidance](https://tiptap.dev/docs/hocuspocus/guides/persistence) · [awareness protocol](https://docs.yjs.dev/api/about-awareness).
- Business actions use a separate command API: `workspaceId`, `projectId`, actor identity, required capability, client mutation ID, and expected revision. The server checks rights and current revision in one transaction. It returns the accepted event or a conflict with the current source. Duplicate mutation IDs return the original result. Agent start, status move, rights change, integration, and push never travel as free-form document edits.

## Access, recovery, and migration

Connections require an authenticated member and document-specific read/write rights. The service must recheck authorization at the update boundary and disconnect revoked clients. A display name alone is not an identity. The current guest bearer links are unsuitable as team credentials and will not be silently upgraded.

After a disconnect, the client first recovers durable document updates and the event cursor, then resends still-unconfirmed business commands with their original mutation IDs. A stale expected revision returns a visible choice to rebase, discard, or ask the team; it never overwrites another member's work. Presence expires separately. Server restart must preserve documents and accepted command results.

Existing local projects stay local until the owner chooses a team migration preview. That preview lists exactly which board, diagram, chat, and source metadata would be uploaded and allows a cancel before transfer. Secrets, local browser profiles, agent logs, and personal CLI sessions are excluded. Git source code remains in its configured repository; the coordinator stores planning data and references, not an implicit second copy of a developer's home directory.

## Release slices and evidence

1. **Coordinator foundation:** persisted workspaces, projects, memberships, scoped invite acceptance, and revisioned card commands. Test two app clients against one coordinator; reject wrong-project and revoked credentials. Keep local-only mode working.
2. **Live card editing:** two clients edit the same card description, see presence, disconnect and reconnect, and retain both nonconflicting edits after coordinator restart. A status move with a stale revision must not silently win.
3. **Live Whiteboard:** shared objects and connectors use stable IDs, with selection/presence and explicit promotion of a draft object to a card. Two clients must not create duplicate cards from one promotion request.
4. **Decision dashboard and shared AI drafts:** show actual questions, reviews, conflicts, and teammate activity with source links. AI drafts remain proposed until a permitted member applies them.
5. **Worker coordination:** laptops bring their own agents, work in isolated Git worktrees, and report changed paths and revision evidence. The coordinator warns about overlap before integration. A later optional server worker uses team-owned credentials.

The first acceptance demo uses two distinct authenticated clients, not two anonymous labels in one app. A separate self-hosted run verifies that a colleague can still edit while the owner's laptop is off. Each slice needs backend authorization tests, a real two-client UI path, restart/offline tests, and a visible failure state before it is called complete.
