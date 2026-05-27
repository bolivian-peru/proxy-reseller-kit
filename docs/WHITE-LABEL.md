# White-Labeling the Gateway (hide `gw.proxies.sx`)

Your customers never need to see `gw.proxies.sx`. The Pool Gateway is a plain
TCP/HTTP(S) proxy on ports **7000** (HTTP) and **7001** (SOCKS5) — it accepts a
connection on its IP regardless of the hostname the client used, and auth lives
entirely in the proxy username/`pak_` credentials. So you can put **your own
domain** in front of it with nothing more than a DNS record + one config value.

## How it works

```
customer's HTTP client
  → proxy.yourbrand.com:7000        (DNS A record → gateway IP)
  → (same machine as gw.proxies.sx) → authenticates by username + pak_ → routes
```

The proxy URL string your app hands the customer is built **client-side** by the
kit (`buildProxyUrl` / the React components). Point that at your domain and the
customer never sees ours.

## Setup (2 steps)

### 1. DNS — alias your domain to the gateway IP
Add an **A record** (DNS-only — NOT a CDN/Cloudflare-proxied "orange-cloud"
record; proxy ports aren't web HTTPS):

```
proxy.yourbrand.com.   A   46.224.98.3
```

No TLS certificate is needed on your domain for the proxy ports — the proxy
protocol carries its own auth. (HTTPS only matters for your dashboard, not the
proxy endpoint.)

### 2. Set `gatewayHost` everywhere in the kit
`gatewayHost` defaults to `gw.proxies.sx`; override it in **every** surface that
emits a proxy URL, or a missed one will leak the default:

```ts
// server route factory → flows into the /me response → PoolPortal uses it
createPoolApiHandlers({ proxies, getSessionUserId, getUserKeyId,
  gatewayHost: 'proxy.yourbrand.com' });

// SDK client → buildProxyUrl()
new ProxiesClient({ apiKey, proxyUsername, gatewayHost: 'proxy.yourbrand.com' });

// React components that render connection strings
<PakQuickstart      gatewayHost="proxy.yourbrand.com" ... />
<PoolSessionSpawner gatewayHost="proxy.yourbrand.com" ... />
<PoolDocsPanel      gatewayHost="proxy.yourbrand.com" ... />
```

Result — your customers copy:
```
http://psx_xxx-mbl-us-sid-alice:pak_xxx@proxy.yourbrand.com:7000
socks5://psx_xxx-mbl-us:pak_xxx@proxy.yourbrand.com:7001
```

## Notes
- The gateway IP (`46.224.98.3`) is shared **infrastructure** — safe to point DNS
  at. It is **not** a peer/exit IP, so this does not expose any device.
- Use a single `gatewayHost` constant in your app and pass it to all components
  so you can't miss one. (`<PoolPortal>` already reads it from `/me`.)
- Multiple resellers can each alias their own domain to the same gateway IP —
  hostnames are cosmetic to the proxy; routing is decided by the `pak_` + the
  username token DSL, not the hostname.
- Ports 7000/7001 must be reachable from your customers (they are, publicly).
