# Screenshot review

This first team-review slice lets two people discuss the **same saved card QA screenshot**. The normal links stay on the host computer; an optional Tailscale link lets a reachable peer open the review. It does not synchronize projects or run agents for a guest. The host chooses when to create a room and whom to invite.

## Use it

1. Run card browser QA against an explicitly approved local development route and open a report with a saved screenshot.
2. Expand **Gemeinsamer Bild-Review**, enter a short scenario and reviewer name, and choose **Lokalen Reviewstand erstellen**. The room takes an immutable copy of that report's PNG. The displayed checkout hash is only an observation made by QA; it does not prove which files the development server served.
3. Choose **Im Browser prüfen** to open the guest view on this computer, or copy the link. Create a separate invitation for another reviewer. For a colleague on the same Tailscale network, choose **Tailscale-Link erstellen** for that person instead. Branchloom checks that the local Tailscale client is connected and binds a second review listener only to its reported IPv4 address. It does not alter Tailscale Serve or the other services on your device. The colleague needs permission to reach your device in the tailnet.
4. Each link is shown once and contains an access secret. A reviewer can select a point and add a comment. The card owner sees the comments in the report. Refreshes poll for new comments; a failed post can be retried with the same request ID to avoid a duplicate.
5. Revoke an invitation to stop its access. Close the room to stop new comments while keeping the saved discussion visible.

The normal listener binds **127.0.0.1** on an ephemeral port. The optional Tailscale listener binds only the active local Tailscale IPv4 address, never `0.0.0.0` or a general LAN interface. It accepts only secrets explicitly issued for that Tailscale listener; an older local link does not become reachable through it. Both listeners stop when Branchloom quits. A previously copied link will not survive an app restart because its port can change; create a new invitation for the same saved room. The original secret cannot be recovered from storage. After a temporary network interruption, the guest page retries an unconfirmed comment with its original request ID. A second-device outage and reconnect have not yet been verified.

The Tailscale link uses HTTP **inside the encrypted tailnet connection**. Tailscale documents that [direct and relayed connections are end-to-end encrypted](https://tailscale.com/docs/reference/connection-types); the browser may still label the page as insecure because this preview does not add HTTPS on top. An HTTPS Tailscale Serve option and a hosted team path remain open. [Tailscale's device and access setup](https://tailscale.com/docs/how-to/connect-to-devices) is separate from Branchloom's reviewer link. Do not forward a Tailscale review URL outside the intended group.

Guest access is limited to one room's screenshot and comments. A guest cannot start an agent, merge code, change the board, or use the host app's IPC. Invitation secrets are stored as hashes in SQLite, and HTTP requests use exact host and same-origin checks for comment posts. Treat a copied link as a secret: anyone who can reach the listener and has the link can read that review until it is revoked. A screenshot may contain personal or confidential information; inspect it before creating a room.

This is still a bounded review feature, not full team mode. Named reviewers are labels chosen by the host, not verified Branchloom accounts. Boards, worktrees, agent execution, and roles are not synchronized across devices. A QA checkout hash is only a local observation; the app has not proven the served code revision. Markers are positions on an immutable screenshot, not live DOM-element identities. No remote peer outside the host device was available for the current tests.

The database retains up to 30 rooms per project, 20 invitations per room, and 300 comments per room. These are protective limits for this preview, not team-scale storage guarantees.
