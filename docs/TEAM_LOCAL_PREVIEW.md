# Local team preview

This preview runs one authenticated coordinator on the owner's laptop. It binds only to `127.0.0.1`, so a second app instance on the same laptop can join; colleagues on other devices cannot connect yet. The hosted project stays in the owner's local SQLite database. Joining does not copy the project repository, source files, CLI credentials, or browser profile.

## Start two separate local clients

Use Windows, Node.js 24, Git, and a clean source checkout. Run `npm ci`, `npm run build`, and `npm run typecheck` once in the Branchloom folder. Then open two PowerShell windows in that folder:

```powershell
# Window 1: owner profile
$env:BRANCHLOOM_DEV_USER_DATA = Join-Path $env:TEMP 'branchloom-team-owner-preview'
npm start
```

```powershell
# Window 2: member profile
$env:BRANCHLOOM_DEV_USER_DATA = Join-Path $env:TEMP 'branchloom-team-member-preview'
npm start
```

The profile paths must be distinct absolute paths. They retain the preview's local data and encrypted credentials across restarts. Do not use a profile that contains your regular Branchloom projects unless you intend to keep this preview there.

1. In the owner window, add an existing local Git project and open **Team**. Create a workspace with your display name. The coordinator starts locally and reuses its saved port after an app restart.
2. Choose a role and create an invitation. Copy its coordinator address and secret to the member window. The secret is shown once. It expires and cannot be used by a different member after acceptance.
3. In the member window, open **Team**, enter the address, invitation secret, and display name, and join. If the acceptance response is lost, use the visible retry option; the client reuses the same protected credential and request ID.
4. Select the same project and card in both windows. Edit the shared draft. An authenticated event stream shows open members and notifies the other editor immediately; a five-second poll remains as a fallback. The accepted card description does not change. A viewer can read the draft but cannot edit it unless the owner explicitly grants the project capability.
5. Close and reopen the app. The coordinator restarts on the saved local port. Pending encrypted draft updates are replayed when that card's editor opens again. An open owner editor also reconnects after a short coordinator restart. A visible Electron test edits the draft while the coordinator is stopped, keeps the encrypted update pending for a polling interval, and verifies one replay after restart. A disconnected client may show an error until the host is running. Lost-response replay is also covered; long network outages and two physical machines are not yet verified.

Members with `manage_task` rights may also change a card's priority or move it between columns through separate revisioned controls. If the card changed before a command reaches the coordinator, Branchloom shows a conflict and asks for an explicit reload. A move is blocked while the project queue, the card's agent session, or an active workflow involving that card is running. Moving a card in this team view does not start an agent; shared text edits cannot change board metadata. Open card views receive an authenticated event for a priority or column change and reload the board; the three-second board poll remains a fallback.

The owner can revoke a member in the Team setup. The next authenticated request is rejected. Project role and capability changes currently require backend support and have no complete UI. A shared draft cannot yet be accepted as the authoritative card or approved by a project admin; that is a separate upcoming command. The [team design](TEAM_SYNC.md) describes the wider roadmap.
