# White-Labeling the Gateway (hide `gw.proxies.sx`)

**Choose the pool explicitly in every connection setup.** Do not rely on the SDK's `mbl` default; use the intended pool and matching stock scope. See [pool selection](./USERNAME-DSL.md#choose-the-pool-explicitly), including residential-only filtering and the `safe` PAK override.

Your customers never need to see `gw.proxies.sx`. The Pool Gateway is a plain
TCP/HTTP(S) proxy on ports **7000** (HTTP) and **7001** (SOCKS5) — it accepts a
connection on its IP regardless of the hostname the client used, and auth lives
entirely in the proxy username/`pak_` credentials. So you can put **your own
domain** in front of it with nothing more than a DNS record + one config value.

## How it works

```
customer's HTTP client
  → proxy.yourbrand.com:7000        (DNS A record → white-label edge address)
  → (same machine as gw.proxies.sx) → authenticates by username + pak_ → routes
```

The proxy URL string your app hands the customer is built **client-side** by the
kit (`buildProxyUrl` / the React components). Point that at your domain and the
customer never sees ours.

## Setup (2 steps)

### 1. DNS — point your domain at the white-label edge address
Ask your account manager for the **white-label edge address** (support or your
Proxies.sx contact sends it privately). It is a dedicated address that answers
only on the proxy ports 7000 (HTTP) and 7001 (SOCKS5), carries no Proxies.sx
hostname or certificate, and has a generic reverse lookup, so your customers do
not see our name.

Add an **A record** to it (DNS-only — NOT a CDN/Cloudflare-proxied "orange-cloud"
record; proxy ports aren't web HTTPS):

```
proxy.yourbrand.com.   A   <white-label edge address>
```

Do **not** CNAME your hostname to `gw.proxies.sx`: a CNAME shows our name in
DNS. Pointing an A record at the main gateway address also works technically,
but a reverse-IP lookup shows that address is shared with Proxies.sx sites.

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

// React components: these examples deliberately use modem routing.
// PakQuickstart and PoolDocsPanel have fixed mbl examples, with no pool prop.
<PakQuickstart      gatewayHost="proxy.yourbrand.com" ... />
<PoolSessionSpawner defaultPool="mbl" gatewayHost="proxy.yourbrand.com" ... />
<PoolDocsPanel      gatewayHost="proxy.yourbrand.com" ... />
```

Result — your customers copy:
```
http://psx_xxx-mbl-us-sid-alice:pak_xxx@proxy.yourbrand.com:7000
socks5://psx_xxx-mbl-us:pak_xxx@proxy.yourbrand.com:7001
```

## Notes
- The white-label edge address is **infrastructure**, not a peer/exit IP, so
  pointing DNS at it does not expose any device. Same credentials, same pool keys.
- Use a single `gatewayHost` constant in your app and pass it to all components
  so you can't miss one. (`<PoolPortal>` already reads it from `/me`.)
- Multiple resellers can each point their own domain at the same edge address —
  hostnames are cosmetic to the proxy; routing is decided by the `pak_` + the
  username token DSL, not the hostname.
- Ports 7000/7001 must be reachable from your customers (they are, publicly).
