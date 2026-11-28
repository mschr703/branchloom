# Two-device team preview over Tailscale

This is an opt-in extension of the [local team preview](TEAM_LOCAL_PREVIEW.md). The owner still hosts the canonical project, SQLite database, repository, and any agent work on their laptop. Both laptops must have Tailscale installed, connected to the same tailnet, and permitted by tailnet access rules. The owner app must remain running. This is not the future VPS coordinator and does not synchronize source checkouts or personal agent credentials.

## Start

1. Install a Branchloom build containing this feature on both Windows laptops. Keep Windows PowerShell available for the DPAPI-protected team credential store. Connect both laptops to Tailscale. On the owner laptop, open the project and create a Team workspace in **Team** if it does not exist.
2. In Team workspace settings, choose **Enable Tailscale access**. Branchloom checks that the Tailscale daemon is running and that its IPv4 address belongs to this laptop, then binds a second coordinator listener to that address only. The existing `127.0.0.1` listener remains available. The UI shows the exact bound address.
3. Choose the member role and **Other device over Tailscale**, then create an invitation. Send the coordinator address and one-time invitation secret to that person through a private channel. The secret is shown once and expires; do not paste it into a public issue or chat.
4. On the other laptop, open **Team → Accept invitation**, enter both values and a display name, and join. The member sees only projects allowed by their team role and project grants. The owner may grant task controls or agent start separately in Team settings. Agent start runs the owner's installed CLI on the owner's laptop.
5. Open the same card draft on both devices. Edits and presence use the authenticated event stream, with a poll fallback. Board priority and column changes use distinct revisioned commands; a text edit alone cannot change them.
6. Choose **End Tailscale access** to close the second listener and its live streams. Closing Branchloom does the same. After restart the owner must explicitly enable Tailscale access again. The local listener remains available. The peer URL uses the same saved loopback port when the app restarts on the same machine, but a changed Tailscale IP or port requires a new address and connection setup.

## Network and security boundary

The peer listener binds to the local address reported by a running Tailscale client. It never binds to `0.0.0.0`, a public interface, or an ordinary LAN address. Requests require a scoped, revocable member credential; invitation acceptance requires a separate expiring secret. Browser origins are rejected. The client checks its own running Tailscale connection before every plain-HTTP tailnet request so a disconnected tailnet does not send a saved bearer token over an ordinary network path. HTTP is carried inside Tailscale's encrypted tunnel. Do not forward the listener port through a router or expose it to the public internet.

The Windows firewall or tailnet access rules may still block an otherwise valid connection. Branchloom does not change either setting. A Tailscale connection alone does not prove that another device can reach this host. If joining fails, verify both devices are online in Tailscale and that peer-to-peer access is allowed. The owner can stop access without deleting the Team workspace; revoking a member also blocks their next request and closes their live stream.

The automated tests cover the opt-in listener lifecycle, host-header rejection, default loopback isolation, URL validation, and the client's no-send behavior when the tailnet is disconnected. A local check also bound the actual Tailscale interface on the development laptop and verified an unauthenticated request was rejected. A full two-physical-device run, long outage, firewall variations, and Windows installer acceptance remain to be verified before calling this production-ready.
