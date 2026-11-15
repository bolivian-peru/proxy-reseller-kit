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

## Custom key prefix

The pool key is the proxy password your customer types, and by default every
key starts with `pak_`. That prefix appears in our public documentation, so it
gives away the upstream behind `proxy.yourbrand.com` as surely as a
`gw.proxies.sx` hostname would. Choose your own prefix and the keys you mint
carry it instead:

```
http://psx_xxx-peer-us:acme_xxx@proxy.yourbrand.com:7000
```

Read the setting with `GET /v1/reseller/pool-keys/key-prefix` (scope
`customers:read`) and change it with `PUT` on the same path (scope
`customers:write`). Both answer `{ "prefix": string | null, "effective": string }`:
`prefix` is what you set (`null` when you have not), `effective` is the prefix
the next key gets. The SDK has no method for these two routes; call them from
your server with the same `psx_` key.

```bash
curl https://api.proxies.sx/v1/reseller/pool-keys/key-prefix \
  -H "X-API-Key: psx_YOUR_API_KEY"
# → { "prefix": null, "effective": "pak_" }

curl -X PUT https://api.proxies.sx/v1/reseller/pool-keys/key-prefix \
  -H "X-API-Key: psx_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":"acme_"}'
# → { "prefix": "acme_", "effective": "acme_" }

# Back to the default
curl -X PUT https://api.proxies.sx/v1/reseller/pool-keys/key-prefix \
  -H "X-API-Key: psx_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prefix":null}'
# → { "prefix": null, "effective": "pak_" }
```

The rules:

- **Format:** 2 to 10 lowercase letters or digits, starting with a letter, then
  one underscore (`acme_`, `px2_`). Anything else answers `400` with a message
  that states the rule.
- **Reserved prefixes are refused** (`400`): our own credential prefixes such as
  `pak_` and `psx_`, well-known secret prefixes of other services such as `sk_`
  and `ghp_`, and generic words such as `key_` or `token_`.
- **`null` restores the default** `pak_`. Sending `"pak_"` is refused as reserved.
- **Only keys created or regenerated afterwards get the new prefix.** Existing
  keys keep working unchanged, whatever their prefix; changing the setting again
  never touches them.
- **To move an existing key, regenerate it** (`poolKeys.regenerate()` or
  `POST /v1/reseller/pool-keys/:id/regenerate`) with a persisted
  `Idempotency-Key`, as the [shared-pool contract](./SHARED-POOL-CONTRACT.md)
  describes, and give the customer the new value. The old value stops
  authenticating new connections within about 30 seconds, when the gateway's
  authentication cache expires. That is a source default, not a guaranteed
  deadline: outage grace and tunnel rechecks can delay it, as for any
  regeneration.
- **Never validate a key by its prefix in your own code.** One account holds keys
  with different prefixes at the same time: keys minted before a change keep
  theirs, and a [Private Pool](./PRIVATE-POOL.md) key is minted under the
  platform's house account and keeps `pak_`. Treat the key as an opaque string in
  forms, imports and support tools (nothing in the kit checks the prefix), and
  extend any log redaction or secret scanning that matches `pak_`, or keys with
  your prefix pass through it unmasked.

## Notes
- The white-label edge address is **infrastructure**, not a peer/exit IP, so
  pointing DNS at it does not expose any device. Same credentials, same pool keys.
- Use a single `gatewayHost` constant in your app and pass it to all components
  so you can't miss one. (`<PoolPortal>` already reads it from `/me`.)
- Multiple resellers can each point their own domain at the same edge address —
  hostnames are cosmetic to the proxy; routing is decided by the `pak_` + the
  username token DSL, not the hostname.
- Ports 7000/7001 must be reachable from your customers (they are, publicly).
