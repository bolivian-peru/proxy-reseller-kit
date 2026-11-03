# The Pool Gateway username DSL — complete reference

> **This file is the single source of truth for the proxy-username grammar.**
> Every other file in this kit links here instead of restating the token list.
> Verified against the gateway parser (`routing/username-parser.ts`), the
> endpoint selector (`redis/endpoint-pool.ts`), and the selection script
> (`redis/lua/select-endpoint.lua`) of the gateway build that is live
> (release `d2e9f99e`, 2026-10-21; re-checked 2026-11-03).

Your customer's HTTP or SOCKS5 client connects to a single endpoint:

```
{protocol}://{username}:{pakKey}@gw.proxies.sx:{port}
```

| Field | Value |
|---|---|
| `protocol` | `http` or `socks5` |
| `port` | `7000` for HTTP, `7001` for SOCKS5 |
| `username` | **your reseller `psx_…` username** plus `-`-separated routing tokens |
| `pakKey` | the customer's `pak_…` secret — this is the **password**, never the username |

```
http://psx_acme-peer-us-sid-cust_8f3a21bd-rot-sticky:pak_a1b2c3@gw.proxies.sx:7000
└─ protocol      └─ username (account + tokens)         └─ password  └─ host:port
```

> **The `pak_` goes in the password field.** The gateway resolves the account
> from the *username* only — by `proxyUsername`, then `psx_<userId>`, then
> e-mail. There is no code path that resolves a `pak_…` username, so
> `pak_xxx-mbl-us` as a username fails auth with `E_AUTH_INVALID`. Build the
> string with `buildProxyUrl(proxyUsername, pakKey, opts)` and you get this
> right by construction.

---

## How the parser behaves (read this before the table)

The username is **lowercased, stripped of whitespace, and split on `-`**. Two
consequences that cause most integration bugs:

1. **No token value may itself contain a `-`.** `T-Mobile US` must be sent as
   `tmobile`. The SDK slugifies `carrier` / `isp` / `city` for you.
2. **The parser is self-healing and never returns 400 for a bad optional
   token.** It sanitizes, aliases, and defaults — then routes anyway, recording
   what it fixed in an ops-only `corrections[]` log the customer never sees.
   The only hard failures are a missing username or one longer than 256 chars.

The practical danger is the flip side of that forgiveness: **a token you got
wrong does not error — it is repaired or dropped.** An unknown token is skipped
and an unparseable value falls back to a default, so a typo in a token name
looks like success. The filters themselves are the opposite: every targeting
token the parser accepts is a **hard** filter that is never dropped on a retry
("explicit filters are a purchase contract; an empty matching pool is an honest
refusal"), so a filter that matches no stock returns `E_NO_STOCK_COUNTRY`. The
"If nothing matches" column below is the most important column in this document.

**Corollary for SDK authors:** the client must never be *stricter* than the
gateway. Rejecting something the gateway would have accepted turns a working
request into a build-time crash. The one deliberate exception is `sid`, which is
validated client-side because a mangled sid silently routes to the *wrong
session* rather than failing — see `validateSid` in `packages/sdk/src/url.ts`.

---

## Grammar

```
psx_<accountId>-<pool>-<country>[-<token> <value> …]
```

The first three fields are positional. Everything after is order-independent.

| Position | Field | Values | If omitted |
|---|---|---|---|
| 1 | `accountId` | your `psx_…` reseller username | **required** — the only hard failure |
| 2 | `pool` | `mbl` · `peer` · `any` · `best` | defaults to `any` |
| 3 | `country` | ISO 3166-1 alpha-2, or `any` | defaults to `any` (**global**, not "your country") |

Aliases are accepted and corrected silently: `mobile`/`modem`/`lte`/`4g`/`5g` →
`mbl`; `residential`/`resi`/`home` → `peer`; `usa`/`america` → `us`;
`uk`/`britain`/`england` → `gb`; `georgia` → `ge`.

### The two pools

| Pool | What it is | Countries |
|---|---|---|
| `peer` | **The flagship network.** Community SDK devices sharing bandwidth — **mixed mobile + residential**, not residential-only. Widest reach. | ~82–120, varies with live supply |
| `mbl` | **The supportive carrier-modem tier.** ProxySmart 4G/5G modems we operate. Smaller, ultra-stable, monitored. | exactly 6: `us` `gb` `fr` `nl` `pl` `ge` |
| `any` / `best` | No pool filter — the selector picks on health and load across both. | union of the two |

> **`ge` is GEORGIA, not Germany.** Germany is `de`, and `de` has **no `mbl`
> stock** — `mbl-de` always fails. Use `peer-de`.

Both pools bill identically: **$4.00/GB list, volume-discounted to $2.40/GB on
a single order of 250 GB+. Duration is free — you pay for traffic only.**
Wholesale terms agreed with Proxies.sx for your account are not in this kit;
the list price is what the public endpoints publish.

> The discount tier comes from the quantity on **one purchase**, not from a
> monthly total — nothing accumulates across the month. 25 orders of 10 GB earn
> **0%**; one order of 250 GB earns 40%. Full table and the margin trap it
> creates: [`PRIVATE-POOL.md`](./PRIVATE-POOL.md#pricing).

> **Country tiers (live since 2026-10-12).** A GB of traffic that *exits* in a
> lower-tier country uses only a fraction of a GB of balance: `pricing.tiers[]`
> in `GET /v1/gateway/pool/stock` lists the tiers (`burnRate` 1 / 0.375 /
> 0.1875 — Premium, Plus, Standard) and which countries are in each; `pricing.live`
> says whether the burn is in force. A `pak_` cap still counts **raw** GB carried.
> Read it from the endpoint; the country lists change without an SDK release.

**Per-pool stock differs per country.** A country can have modems but no peers,
or the reverse. Filter your country picker by the selected pool using the live
per-country `modem` / `peer` counts — see [Verify it works](#verify-it-works).

---

## Every token

Eleven optional tokens, three `pin` sub-types, and the `any` wildcard — the
fifteen words the parser recognises. Every targeting token is **hard**: a
non-matching endpoint is excluded from selection, and the gateway never drops
a filter on a retry.

| Token | Value shape | Kind | **If nothing matches** |
|---|---|---|---|
| `rot` | one of the rotation modes below | behaviour | Unrecognised value → **`auto10`**, silently. There is no error. |
| `sid` | 1–64 chars `[a-z0-9_]`, no `-` | session identity | Unusable value → **the sid is dropped and you get no stickiness**, silently. Each connection then starts a fresh synthetic session. `-session-<id>` is accepted as an alias and rewritten to `sid`. |
| `ttl` | integer seconds, clamped **60 – 2 592 000** | session-row lifetime | Non-numeric → `3600`. Out of range → clamped. **Immutable for a live sid** — see [TTL is immutable](#ttl-is-immutable-per-session). |
| `carrier` | slug, ≤64 chars, e.g. `att` | **hard**, exact slug match on the device's carrier *or* ISP name | No candidate → `E_NO_STOCK_COUNTRY` (502). Never widened. Prefer `asn` when you have it. |
| `city` | slug, ≤64 chars, e.g. `brooklyn` (from `/stock/cities`) | **hard**, peer only | No routable peer in that city → 502. Modems never match a city, so `mbl` + `city` always refuses. |
| `state` | ISO subdivision code, e.g. `ca`, `ny` | **hard**, peer only | No routable peer in that region → 502; refuses on `mbl`. Discover regions via `client.pool.getCities(cc).regions` or the cross-filtered `getFacets({country}).states`. |
| `iptype` | `mobile` · `residential` · `datacenter` | **hard** | No candidate → 502. Unclassified peers are excluded; a modem with no explicit class counts as `mobile`. |
| `isp` | brand slug, e.g. `spectrum` | **hard**, slugified contains-match | No candidate → 502. |
| `asn` | 1–7 digits, e.g. `7018` | **hard**, exact | No candidate → 502. |
| `failover` | `any` · `samecountry` · `samecarrier` · `samenode` · `strict` | policy, default `samecountry` | Unrecognised → `samecountry`. `strict` disables all substitution and fails clean instead. |
| `pin` | `-pin-<type>-<id>` — consumes **two** parts | **hard** | See [Pinning](#pinning-port-device-lease). An unknown *type* is **dropped entirely and silently**. |
| `strict` | **bare flag — no value** | modifier | Only active with `rot sticky`/`hard`; a no-op for every other mode. See [Strict sticky](#strict-sticky). |

Unknown tokens are skipped for forward compatibility, with a correction
recorded on the gateway side that the customer never sees. `-session-<id>` is
the one spelling the live gateway rewrites to `sid` for you; any other typo in
a token name (`-sticky-` instead of `-rot-sticky`, `-country-us`) is silently
dropped.

### Rotation modes

| Mode | Interval | Behaviour |
|---|---|---|
| `auto5` `auto10` `auto20` `auto60` | 5 / 10 / 20 / 60 min | Soft-rotate: re-pick a different endpoint each interval. |
| `ondemand` | — | Re-pick only when a new connection is opened. |
| `sticky` | — | Pin the endpoint for the session. Selector weights IP-stability. |
| `hard` | — | **Pins exactly like `sticky`.** It is *not* "a new IP per request". |

**Omitting `-rot-` applies the gateway default, `auto10`** — a different
endpoint roughly every 10 minutes. It is not "no rotation" and not "a fresh IP
per request". If you want a held endpoint, ask for `sticky`; if you want faster
turnover, ask for `auto5`. The SDK's `rotation: 'none'` is a *client-side*
sentinel meaning "emit no `-rot-` token", so it lands on this same `auto10`
default.

`hard` deserves the emphasis because the name misleads. A true carrier-IP reset
(the ProxySmart airplane-mode toggle) only happens through an explicit rotate
action, and is a no-op for peer devices, which do not expose one. At routing
time `hard` ≡ `sticky`.

---

## The two things that surprise customers

### 1. Sticky pins the MODEM, not the IP

Mobile carriers run CGNAT and re-issue a held modem's egress IP on their own
cadence — T-Mobile especially. A perfectly pinned modem can still show
different exit IPs across short calls. Sticky is a contract about *which device
carries your traffic*, not about the address it presents.

If a workflow genuinely needs one IP held across its whole life
(`cf_clearance`, banking 2FA, mTLS bound to source IP), the options in
increasing strength are:

1. `pool: 'peer'` with `rotation: 'sticky'` — home-ISP peers hold IPs for
   hours-to-days.
2. Add the `strict` flag — a hard stability floor on top (below).
3. A **Reserved IP** — an exclusively leased device — see
   [`RESERVED-IPS.md`](./RESERVED-IPS.md).
4. A dedicated modem on a static-IP carrier plan (a different product; talk to
   Proxies.sx).

Telling a customer "sticky = same IP" is the single most common way a reseller
generates an unwinnable support ticket. Say "same device".

### 2. `sticky` and `auto*` need a `-sid-`

The sid is the session's name. Without one, **every connection creates a fresh
synthetic session** (a generated `auto_<ts>_<rand>` id with a 5-minute TTL), so
nothing persists across connections and `sticky` looks broken.

```
psx_acme-peer-us-rot-sticky                       ← new endpoint on every connection
psx_acme-peer-us-sid-cust_8f3a21bd-rot-sticky     ← actually sticky
```

The inverse also bites: **a `-sid-` on its own is not sticky either.** With no
`-rot-`, the default `auto10` applies, so a named session still soft-rotates
about every 10 minutes. You need *both* tokens.

Use a stable per-customer id with ≥8 characters of entropy (`cust_8f3a21bd`) so
two customers can never collide on one session.

---

## TTL is immutable per session

`-ttl-` sets the lifetime of the **session row**, not of an IP. It is written
once, when the session row is created.

Every subsequent request re-applies the **stored** TTL — the gateway reads `ttl`
back off the session hash and re-expires with that value, ignoring whatever the
current username says. So:

> **Changing `-ttl-` on a sid that already exists does nothing until that row
> expires on its own.** To apply a new TTL immediately, use a new `sid`.

This is the mechanism behind "my sticky session died overnight": the default is
3600 s of *idle* life. A long-lived worker that pauses longer than its TTL loses
the row and re-picks an endpoint. If a session must survive an idle weekend,
set `ttl` at creation — the ceiling is 2 592 000 s (30 days).

---

## Pinning: `port`, `device`, `lease`

`-pin-<type>-<id>` consumes the next **two** parts and targets one specific
endpoint. Three types exist:

| Type | Id shape | Use |
|---|---|---|
| `lease` | `l` + 8–12 chars `[a-z0-9]`, e.g. `l23d4e83c5b` | **Reserved IPs.** Resolved through a backend-owned pointer to whichever device the lease currently holds, so the credential stays correct across rotations. |
| `device` | endpoint id | Legacy direct pin. Still supported — credentials already in customers' hands use it. |
| `port` | endpoint id | Direct pin to a port. |

Prefer `lease` for anything reserved. `device` bakes a *mutable* endpoint id
into a credential the customer keeps; after a rotation that string quietly
routes onto hardware the lease no longer reserves.

Three sharp edges, all silent:

- **An unknown pin type is dropped entirely.** `-pin-foo-abc` does not error —
  the whole pin vanishes and the request falls through to ordinary shared
  selection. The customer paid for a specific exit and got a random one.
- **`pin.id` is the only value the parser does not sanitize.** It is read raw,
  so a `-` anywhere inside truncates the token and the pin resolves to nothing.
  The SDK validates it at build time for exactly this reason (a new throw — see
  [`MIGRATION-DSL-COMPLETENESS.md`](./MIGRATION-DSL-COMPLETENESS.md)).
- **Failure modes differ by type.** A `lease` pin whose lease is released,
  expired, or held by someone else **fails closed** — it never substitutes. A
  `device`/`port` pin that is merely missing or offline **is substitutable**
  unless you also pass `failover: 'strict'`.

---

## Strict sticky

`strict` is a **bare token** — it takes no value. `-rot-sticky-strict` parses
naturally as `rot=sticky` followed by the flag, because the DSL splits on `-`.

It is only meaningful alongside `sticky` or `hard`. When active, the selector
weights the endpoint's observed IP-stability score at 0.7 **and** applies a hard
minimum-stability floor, so you land on the device whose exit IP holds best.
Pair it with `pool: 'peer'` for the strongest IP-hold this DSL can express.

For `auto*` and `ondemand` it is silently a no-op.

---

## Worked examples

```bash
# Flagship peer network, US, held device, named session
psx_acme-peer-us-sid-cust_8f3a21bd-rot-sticky

# Same, with the hardest IP-hold the DSL offers
psx_acme-peer-us-sid-cust_8f3a21bd-rot-sticky-strict

# Carrier modems, UK, rotate every 5 minutes
psx_acme-mbl-gb-rot-auto5

# Residential peers in New York state only — hard, refuses if none are online
psx_acme-peer-us-state-ny-iptype-residential-sid-cust_8f3a21bd-rot-sticky

# Residential peers only, on one specific network, fail rather than substitute
psx_acme-peer-us-iptype-residential-asn-7922-failover-strict

# A Reserved IP — pinned by lease, survives rotation, 12h idle window
psx_acme-peer-us-sid-res01-pin-lease-l23d4e83c5b-rot-sticky-ttl-43200

# Germany: peer only. `mbl-de` has no stock and always fails.
psx_acme-peer-de-rot-auto10
```

---

## Verify it works

Never assume a generated string routes — prove it. One command:

```bash
curl -x "http://<username>:<pak>@gw.proxies.sx:7000" https://api.ipify.org
```

A bare IP in the response means the whole chain works: credentials accepted,
tokens parsed, an endpoint selected, traffic egressed. Full round trip from
nothing:

```bash
# 1. Mint a 1 GB test key (psx_ API key, server-side)
RESPONSE=$(curl -s -X POST https://api.proxies.sx/v1/reseller/pool-keys \
  -H "X-API-Key: psx_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"smoke-test","trafficCapGB":1}')
PAK=$(echo "$RESPONSE" | grep -oE 'pak_[a-z0-9]+' | head -1)
KEY_ID=$(echo "$RESPONSE" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)

# 2. Route real traffic. USERNAME is your psx_ reseller username.
curl -x "http://USERNAME-peer-us:$PAK@gw.proxies.sx:7000" https://api.ipify.org

# 3. Prove stickiness holds a device across calls (same sid + rot-sticky)
for i in 1 2 3; do
  curl -s -x "http://USERNAME-peer-us-sid-smoke_test1-rot-sticky:$PAK@gw.proxies.sx:7000" \
    https://api.ipify.org; echo
done

# 4. SOCKS5 on 7001 uses the identical username
curl -x "socks5://USERNAME-peer-us:$PAK@gw.proxies.sx:7001" https://api.ipify.org

# 5. Clean up
curl -s -X DELETE "https://api.proxies.sx/v1/reseller/pool-keys/$KEY_ID" \
  -H "X-API-Key: psx_YOUR_API_KEY"
```

On step 3, expect the *device* to be held. The addresses may still differ if
the carrier re-NATs — that is the CGNAT behaviour above, not a gateway fault.

Live per-country stock, counts only, before you offer a country in a picker:

```bash
curl -s https://api.proxies.sx/v1/gateway/pool/availability
# → { "countries": { "US": { "modem": 40, "peer": 120 }, … } }
```

**Exit IPs are never enumerable, by design** — availability is reported as
counts per country and nothing else. Do not print, log, or display a peer's
exit IP anywhere in a product built on this kit; IP-reputation vendors scrape
exactly that, and a leaked inventory poisons the pool for every customer on it.

---

## Error codes you will see

Returned as `CODE: message (req: uuid)`.

| Code | Status | Meaning |
|---|---|---|
| `E_AUTH_REQUIRED` | 407 | No `Proxy-Authorization` header. |
| `E_AUTH_INVALID` | 407 | Credentials rejected — wrong username shape, unknown account, disabled or expired key. |
| `E_CAP_EXCEEDED` | 407 | The `pak_` hit its GB cap (`cap_exceeded`). Branch on this code rather than parsing the message. |
| `E_BALANCE_EXHAUSTED` | 407 | The key is valid but **your reseller account** has no shared GB left — every key under it refuses until you top up. Not a per-key condition. |
| `E_USERNAME_PARSE` | 400 | Username missing or > 256 chars — the only parse failures that exist. |
| `E_RATE_LIMITED_AUTH` | 429 | Too many failed auths (per-IP 10/min → 30 s ban, 30/min → 5 min; per-account 25/min, 60/min). |
| `E_RATE_LIMITED_CONN` | 429 | Over the concurrent-connection ceiling — **500 per account** (all your keys share it; raised per account on request). |
| `E_SESSION_LIMIT` | 429 | Over the concurrent-session ceiling — **250 per account**, shared by every `-sid-` across all your keys. |
| `E_GATEWAY_CAPACITY` | 503 | The gateway's shared socket ceiling, not your account's — retry shortly. |
| `E_WRONG_PORT` | 400 | An HTTP request on the SOCKS5 port (7001) or a SOCKS handshake on 7000. |
| `E_NO_STOCK_COUNTRY` | 502 | Nothing online matched the filters. The message suggests a nearest alternative. |
| `E_STOCK_DEGRADED` | 502 | Endpoint selected, then went away mid-request. |
| `E_SSRF_BLOCKED` | 403 | Target is private, localhost, or cloud metadata. |
| `E_INTERNAL` | 503 | Unexpected — file a ticket with the `req:` id. |

If you are debugging a token that "does nothing", check its spelling first:
an unknown token name is skipped without an error, so a misspelt filter looks
exactly like success. A correctly spelt filter that cannot be satisfied is the
opposite case — it refuses with `E_NO_STOCK_COUNTRY` rather than widening.
