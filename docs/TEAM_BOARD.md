# Read-only project board for guests

Branchloom can issue a short-lived link to a view of one local project's board. The host stays in control of the project and its agents. This is the first limited cooperation step, not a synchronized team workspace.

## Try it

1. Open a project, then its project settings and **Projektboard teilen**.
2. Enter a guest name. Choose **Auf diesem Gerät testen** for a local browser link, or **Tailscale-Link erstellen** for a peer on your tailnet. The latter requires a connected local Tailscale client and network permission for the peer to reach your device.
3. Inspect the board and its card titles before sending the link. Copy the new link; Branchloom shows the full secret only immediately after creation. Make a separate invitation for each guest.
4. The guest opens the link in a regular browser. The view refreshes every 15 seconds and also retries when the browser reports that it is back online. They can see the project name, columns, up to 200 active card titles and priorities, queue state, and which cards have a running session. They cannot change cards or start an agent.
5. Revoke an individual invitation in project settings when it is no longer needed. The guest page clears its board on its next refresh. Links expire after 24 hours; app restart also revokes them.

The local listener binds to `127.0.0.1` on an ephemeral port. The optional peer listener binds only to the active local Tailscale IPv4 address, not every network interface. It uses HTTP inside the tailnet connection. It does not configure Tailscale Serve or alter other network services. A copied URL contains a bearer secret: anyone who can reach that listener and has the URL can read the shared view until expiry or revocation. There is no verified Branchloom account identity or role system yet.

The guest endpoint is a separate, read-only projection. It does not include descriptions, paths, agent names, logs, credentials, or host IPC. Obvious key-like text in a title is hidden, but arbitrary personal text in titles cannot be detected reliably; the host must inspect titles before sharing. A truncated marker appears when more than 200 active cards exist. Invitations are scoped to their project and stored as secret hashes in the local SQLite database. The running app keeps the issued secrets in a listener allowlist; no old link becomes valid on a later app run.

This does not synchronize changes back from guests. Guests cannot edit, comment, bring their own agents, resolve collisions, or merge. A two-window Electron smoke and an actual Tailscale-address listener smoke passed on the development machine; a remote second device and network-loss recovery remain unverified. [Screenshot review](TEAM_REVIEW.md) remains a separate sharing path with point comments.
