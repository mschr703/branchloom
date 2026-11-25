# Local screenshot review

This first team-review slice lets two browser tabs discuss the **same saved card QA screenshot**. It does not synchronize projects or run agents for a guest. The host chooses when to create a room and whom to invite.

## Use it

1. Run card browser QA against an explicitly approved local development route and open a report with a saved screenshot.
2. Expand **Gemeinsamer Bild-Review**, enter a short scenario and reviewer name, and choose **Lokalen Reviewstand erstellen**. The room takes an immutable copy of that report's PNG. The displayed checkout hash is only an observation made by QA; it does not prove which files the development server served.
3. Choose **Im Browser prüfen** to open the guest view on this computer, or copy the link. Create a separate invitation for another reviewer. Each link is shown once and contains an access secret. A reviewer can select a point and add a comment. The card owner sees the comments in the report. Refreshes poll for new comments; a failed post can be retried with the same request ID to avoid a duplicate.
4. Revoke an invitation to stop its access. Close the room to stop new comments while keeping the saved discussion visible.

The current listener binds **127.0.0.1** on an ephemeral port. Links cannot be opened from a colleague's computer, even on the same LAN or Tailscale network. This is a local two-view prototype; remote transport, user identity, team membership, shared agent execution, synchronized boards, collision detection, and role management are still open. The listener starts when the host creates an invitation and stops when Branchloom quits. After an app restart, create a new invitation to start it again. The original secret cannot be recovered from storage.

Guest access is limited to one room's screenshot and comments. A guest cannot start an agent, merge code, change the board, or use the host app's IPC. Invitation secrets are stored as hashes in SQLite, and HTTP requests are bound to the loopback host with same-origin checks for comment posts. Treat a copied link as a secret: anyone with it on the same computer can read that review until it is revoked. A screenshot may contain personal or confidential information; inspect it before creating a room.

The database retains up to 30 rooms per project, 20 invitations per room, and 300 comments per room. These are protective limits for this preview, not team-scale storage guarantees.
