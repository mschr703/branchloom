# Local network team preview through HTTPS

Branchloom can connect two computers on the same private network while one owner laptop remains on. The owner app keeps its coordinator on `127.0.0.1`; an explicitly configured HTTPS reverse proxy accepts the other computer. This setup does not require a Branchloom subscription or Tailscale. The owner must keep Branchloom and the proxy running. It does not provide discovery, cloud sync, a server worker, or a tested two-device release yet.

## Owner setup

1. In **Team**, create a workspace. The Team view shows a local coordinator address such as `http://127.0.0.1:4567`. Note its actual port.
2. Find this computer's private LAN IPv4 address, for example `192.168.1.20`. Use one assigned to the owner computer, not a public or Tailscale address. Make sure the teammate can reach it on the same private network.
3. Configure an HTTPS reverse proxy that binds **only** that LAN address and forwards to the local coordinator. This example uses [Caddy's `bind`](https://caddyserver.com/docs/caddyfile/directives/bind), [`reverse_proxy`](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), and [`tls internal`](https://caddyserver.com/docs/caddyfile/directives/tls). Substitute the actual LAN IP and coordinator port:

   ```caddyfile
   {
       auto_https disable_redirects
   }

   https://192.168.1.20:8443 {
       bind 192.168.1.20
       tls internal
       reverse_proxy 127.0.0.1:4567 {
           header_up Host 127.0.0.1:4567
       }
   }
   ```

4. Trust the proxy's local certificate authority in the **Windows system trust store on both computers** before connecting. Caddy's [running guide](https://caddyserver.com/docs/running) explains why the second device needs its root CA. Branchloom's Electron main process adds the Windows system roots to Node's TLS trust when this LAN transport is selected; no certificate check is disabled. Caddy issues a certificate for the configured IP site address, and the client verifies that IP against the certificate. Open only the chosen HTTPS port in the private network's firewall; do not forward it from the internet. Never disable TLS certificate validation in Node, Branchloom, or the proxy.
5. In **Team → Verbindung**, choose **Lokales Netz mit HTTPS-Proxy**, enter `https://192.168.1.20:8443`, then create the invitation. Branchloom tests the certificate and confirms that the address reaches this exact running coordinator before displaying an invitation code. Share the address and code privately with the teammate.

## Teammate setup

On the second computer, open **Team → Einladung annehmen** and enter the HTTPS address, one-time code, and your name. Branchloom verifies the TLS certificate through the operating system trust store, saves the member credential encrypted in its user profile, and reuses it on reconnect. The owner can revoke the member in **Team**. Role and project rights still apply to every request.

## Limits and recovery

- This is an advanced local setup, not one-click LAN pairing. If the LAN IP or owner coordinator port changes, update the proxy configuration and issue a new invitation with the new HTTPS address. Existing member credentials remain bound to the saved address until a supported connection migration exists.
- An HTTPS reverse proxy is required because a plain HTTP LAN listener would expose invitation and member credentials to other devices on that network. The app refuses plain LAN HTTP and does not bind the coordinator to `0.0.0.0` or a LAN address.
- If the owner app or network goes offline, teammates cannot edit the canonical board until it returns. A queued shared card-draft update can replay after reconnect; accepted board commands still require a current revision and must not be silently repeated.
- This path has unit checks for address validation, TLS/redirect failure, and coordinator identity. It has not yet been exercised between two physical machines with a real proxy and firewall configuration. Follow [team preview](TEAM_LOCAL_PREVIEW.md) and [current status](STATUS.md) for the wider feature boundary.
