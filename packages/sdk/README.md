# @proxies-sx/pool-sdk

**Explicitly choose `pool`; do not rely on the SDK mobile-pool default.**
URL builders default to `mbl`; choose `peer` for the shared SDK network,
`peer` plus `ipType: 'residential'` for residential-only routing, or `any` only
when mixed pools are intended. A `qualityTier: 'safe'` PAK forces `mbl`.
Keep discovery and generated connections on the same chosen pool.
See [pool selection](../../docs/USERNAME-DSL.md#choose-the-pool-explicitly) before copying examples.

**Release status:** exact binding reads, conditional release, durable operation lookup
and conditional resume below are candidates until the [release table](../../docs/SHARED-POOL-CONTRACT.md)
confirms deployment and package publication. Client code alone does not release
a provider contract.

[![npm](https://img.shields.io/npm/v/@proxies-sx/pool-sdk)](https://www.npmjs.com/package/@proxies-sx/pool-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)

> Typed TypeScript/JavaScript client for the **[Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy)** reseller API. Mint Pool Access Keys, build proxy URLs, and ship a branded reseller business in an hour instead of a month.

Wholesale pricing with volume tiers — current rates in your [client.proxies.sx](https://client.proxies.sx) dashboard or via [api.proxies.sx/v1/x402/pricing](https://api.proxies.sx/v1/x402/pricing). You set your resale price. One API call mints a per-customer sub-key with its own traffic cap. Wholesale pricing has automatic volume tiers, and high-volume resellers can negotiate custom rates with admin.

---

## Install

```bash
npm install @proxies-sx/pool-sdk
# or
pnpm add @proxies-sx/pool-sdk
# or
yarn add @proxies-sx/pool-sdk
```

Node ≥ 18.17 or any modern edge runtime with global `fetch` (Vercel Edge, Cloudflare Workers, Deno, Bun).

---

## Quickstart

```ts
import { ProxiesClient } from '@proxies-sx/pool-sdk';

// Server-side only — never bundle PROXIES_SX_API_KEY into the browser.
const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY!,     // psx_...
  proxyUsername: process.env.PROXIES_SX_USERNAME!, // psx_abc123 (your reseller ID)
});

// After verified payment, persist immutable intent and this operation ID in your DB.
// This is the provider-call portion, not a complete payment/recovery handler.
const key = await proxies.poolKeys.create({
  label: 'customer:example',
  trafficCapGB: 10,
  idempotencyKey: persistedOperationId,
});

// Build the proxy URL they'll use in their HTTP client
const url = proxies.buildProxyUrl(key.key, {
  pool: 'mbl', // explicitly choose carrier modems for this example
  country: 'us',
  sid: savedConfiguration.sid, // persisted opaque SID unique per logical configuration
  rotation: 'sticky',
});
// → "http://psx_abc123-mbl-us-sid-alice_session1-rot-sticky:pak_...@gw.proxies.sx:7000"

// Hand the URL to the customer
await email(customer, url);
```

Persist the provider result and customer ownership before delivery. If the response
or local save is lost, recover the original operation instead of issuing another
create. Keep payment settlement, entitlement and provider delivery separately tracked.

---

## API surface

### `new ProxiesClient(config)`

```ts
interface ClientConfig {
  apiKey: string;              // Required. psx_... from client.proxies.sx/account (reseller role; scopes below)
  proxyUsername?: string;      // e.g. "psx_abc123" — required to call buildProxyUrl
  baseUrl?: string;            // Default: "https://api.proxies.sx/v1"
  gatewayHost?: string;        // Default: "gw.proxies.sx"
  timeout?: number;            // Default: 30000 (ms)
  retry?: false | RetryConfig; // Read retry policy; shared-pool mutations make one attempt
  fetch?: typeof fetch;        // Override for older Node or mocking
}

interface RetryConfig {
  attempts?: number;       // Default 3 (1 = no retries)
  baseDelayMs?: number;    // Default 250
  maxDelayMs?: number;     // Default 4000
}
```

Reads retry on `5xx`, `429`, timeouts and network errors, honoring
`Retry-After`. Shared-pool key and session mutations make **one attempt**,
even with an idempotency key. A timeout or 5xx can follow an applied write;
reconcile the persisted operation instead of retrying automatically.
Other low-level routes retain their existing retry behavior. To disable
all retries, pass `retry: false`.

**Scopes the key needs** (the account must already hold the reseller role —
Proxies.sx grants it; it is not self-serve):

| Scope | Unlocks |
|---|---|
| `customers:read` | `poolKeys.list/get/reveal/audit/auditForKey/usage/operation/operationByToken` |
| `customers:write` | `poolKeys.create/update/topUp/regenerate/delete/resume` |
| `ports:read` | `sessions.list/get` |
| `ports:write` | `sessions.close/closeAll` |
| `traffic:read` | `poolKeys.usageSummary` |

A missing scope is a `403` whose body carries `code: "scope_missing"` and the
scope to add.

### `proxies.poolKeys`

| Method | Returns | Description |
|---|---|---|
| `create({ label, trafficCapGB?, qualityTier?, expiresAt?, idempotencyKey? })` | `PoolAccessKey` | Mint a new key. `trafficCapGB` is a whole number of 1 or more and is required unless the account is a partner account (omitting it returns `400`) |
| `list()` | `PoolAccessKey[]` | List all your keys with usage |
| `get(keyId)` | `PoolAccessKey` | Fetch a single key by id |
| `update(keyId, { label?, enabled?, trafficCapGB?, qualityTier?, expiresAt? }, { idempotencyKey? }?)` | `PoolAccessKey` | Update supported fields; shared-key resume requires the separate conditional route |
| `topUp(keyId, { addTrafficGB?, extendDays?, idempotencyKey? })` | `PoolAccessKey` | Atomically extend cap and/or expiry — use this for top-up flows. `addTrafficGB` is a whole number of 1 or more and is ignored on an uncapped (partner) key. A top-up keeps holds and does not resume a disabled key |
| `regenerate(keyId, { idempotencyKey? }?)` | `PoolAccessKey` | Change the stored secret; caches and existing sockets prevent an immediate revocation guarantee |
| `reveal(keyId)` (v0.5.0+) | `PoolAccessKey` | Audit-logged unmask. Records a `reveal` event server-side. Use in customer-facing dashboards instead of displaying `key` from `list()` |
| `audit({ action?, before?, limit? }?)` (v0.5.0+) | `PoolAccessKeyAuditEvent[]` | Forensic log across ALL of your keys (90-day TTL). Filter by action, paginate via `before` |
| `auditForKey(keyId, { before?, limit? }?)` (v0.5.0+) | `PoolAccessKeyAuditEvent[]` | Forensic log for a single key (`limit` max 200) |
| `usage(keyId, { days? }?)` (v0.14.0+) | `PakUsageSeries` | Per-day `{ date, mbIn, mbOut, mb }` series for ONE key, 1–365 days, gap-filled. Ownership-scoped → the customer's own chart |
| `usageSummary({ days? }?)` (v0.14.0+) | `PakUsageSummary` | Daily GB across ALL your keys + per-key breakdown (90-day rollup). Needs `traffic:read` |
| `delete(keyId, { idempotencyKey? }?)` | `void` | Remove the key through the lifecycle operation; not an immediate socket cutoff |
| `operation(operationId)` | `PoolKeyOperation` | Candidate: secret-free read of original mutation evidence |
| `operationByToken(idempotencyKey)` | `PoolKeyOperation` | Candidate: recover by the token persisted before dispatch; does not repeat the write |
| `resume(keyId, { expectedLifecycleVersion, idempotencyKey })` | `PoolAccessKey` | Candidate: conditionally release a sole cap hold after authorized reconciliation |

#### Private Pool — quality tier (v0.9.0+)

Mint a key with a `qualityTier` to control which devices its traffic routes across:

| `qualityTier` | Routes across | Use for |
|---|---|---|
| `'standard'` (default) | Production modems **+** verified peer devices, modem-preferred with automatic mbl→peer failover | General Pool Gateway access |
| `'safe'` | **Only** production ProxySmart modems we own (a dedicated, modem-grade allocation) — the gateway rewrites any `-peer-`/`-any-` request on the key back to `-mbl-` | Selling a customer an isolated, higher-SLA **Private Pool** |

```ts
// A dedicated, modem-only Private Pool key:
const key = await proxies.poolKeys.create({
  label: `private:${customerId}`,
  qualityTier: 'safe',      // ProxySmart modems only
  trafficCapGB: 100,
});

// Switch an existing key between tiers any time:
await proxies.poolKeys.update(key.id, { qualityTier: 'standard' });
```

The exported `PoolQualityTier` type (`'safe' | 'standard'`) is available for your own signatures. Omitting `qualityTier` keeps the default `'standard'` — zero change for existing keys.

#### Cap suspension and deliberate resume

Raw `trafficUsedMB / 1024` is compared with the cumulative cap. Accounting and
cache delays mean this is not a zero-overshoot guarantee. `topUp()` does not
re-enable a key. A payment does not authorize clearing a security, abuse, manual,
account, expiry or unknown hold. Routine synchronization must never resume keys.

```ts
// Persist this top-up intent/token before its single dispatch.
await proxies.poolKeys.topUp(keyId, {
  addTrafficGB: 10,
  idempotencyKey: persistedTopUpOperationId,
});
```

After the candidate lifecycle contract is deployed, an authorized resume may use
`poolKeys.resume(keyId, { expectedLifecycleVersion, idempotencyKey })`. First
reconcile the intended grant, current raw usage/cap, expiry, account eligibility
and every local/provider hold. The route accepts only a sole cap hold at the
expected version; it rejects concurrent changes. An unknown disable requires
operator review. Do not replace this with `update({ enabled: true })`. See the
[conditional resume contract](../../docs/SHARED-POOL-CONTRACT.md#conditional-resume).

#### Audit log usage (v0.5.0+)

```ts
// Forensic log for a single key — useful for support tooling
const events = await proxies.poolKeys.auditForKey(keyId, { limit: 50 });
const lastFailure = events.find(e => e.action === 'gateway_auth_failure');
if (lastFailure) console.log('Last reject:', lastFailure.metadata.reason);

// Cross-key — find every auto-suspend (cap reviews)
const suspends = await proxies.poolKeys.audit({
  action: 'auto_suspended_cap_exceeded',
  limit: 100,
});

// Audit-logged reveal — replace any "show full pak_" UI with this
const fresh = await proxies.poolKeys.reveal(keyId);
showSecretBriefly(fresh.key);   // and audit log records who/when/where
```

#### Usage series (v0.14.0+)

```ts
// The customer's own chart — scoped: 404 if keyId is not yours
const { series, totalGB } = await proxies.poolKeys.usage(customer.pakKeyId, { days: 30 });
// series[i] = { date: '2026-10-05', mbIn: 120.5, mbOut: 8.1, mb: 128.6 }

// Your reconciliation number — every key, one call
const month = await proxies.poolKeys.usageSummary({ days: 30 });
// { days, totalGB, activeKeys, series: [{ date, gb }], byKey: [{ keyId, label, keyPrefix, gb, lastUsedAt }] }
```

Both count **raw** GB carried by the key. The platform's country-tier pricing
(`pool.getStock().pricing`) only changes how much of *your* balance a GB burns.

**No `pak.*` webhooks exist** on the platform today — `/v1/reseller/webhooks`
emits port and sub-account events only — so poll `list()` / `audit()` /
`usageSummary()` for cap and expiry changes.

#### `psx_` API-key callers bypass FreshAuthGuard

The platform requires recent auth (JWT < 5 min OR `X-Confirm-Password`) for `POST /pool-keys` and `POST /:keyId/regenerate` from interactive sessions. **Server-side `psx_` callers (this SDK) bypass it entirely** — no code change needed. Compensating controls: per-key rate limit + audit log.

### `proxies.sessions`

Resolve the authenticated customer's PAK record ID on your server and pass it to
every customer-triggered request. Unscoped methods are reseller/operator tools;
they must never be exposed through customer routes. Client scoping is necessary
but does not by itself deploy provider authorization or PAK binding isolation.

| Method | Returns | Meaning |
| --- | --- | --- |
| `list({ pakId })` | `{ sessions, count, truncated? }` | Bounded observed bindings; not a complete inventory or live-socket count |
| `get(sessionKey, { pakId })` | `SessionBindingObservation` | Candidate: exact owned observation with `binding.bindingGeneration` and `observedAt`; no exit IP or credentials |
| `close(sessionKey, { pakId, generation })` | `{ success, message }` | Candidate: release that owned generation; check `success`, do not retry an unknown outcome |
| `closeAll({ pakId })` | `{ success, count }` | Bounded bulk release; can be refused or partial, not proof every binding is absent |

```ts
const pakId = customer.pakKeyId; // resolved from authenticated ownership
const observed = await proxies.sessions.list({ pakId });
showObservedBindings(observed.sessions, { truncated: observed.truncated });

// After the binding-v2 release is verified and an operator/customer requests release:
const current = await proxies.sessions.get(savedSessionKey, { pakId });
// Persist release intent and this exact generation before dispatch.
const released = await proxies.sessions.close(savedSessionKey, {
  pakId,
  generation: current.binding.bindingGeneration,
});
if (!released.success) markReleaseUnconfirmed();
```

A valid empty list, truncated list or missing row cannot prove an old URL cannot
rebind. Failed reads remain failures. A stale generation returns conflict;
absence is distinct from release success. Do not fall back to an unconditioned
DELETE when a candidate endpoint is unavailable. Without a supplied generation,
the candidate backend observes once and deletes conditionally, but that does not
make a timed-out caller safe to retry.

Release removes a binding, not existing sockets or exported credentials. It does
not guarantee a different IP on reconnect. Persist original named configuration
settings separately; inventory URL templates are not that source of truth.

`ActiveSession` includes observed counters, targeting, TTL, optional
`bindingGeneration` (nullable for legacy rows), `pakKeyId` and credential-free URL
templates. It includes no exit IP. Keep `truncated` and freshness in the UI.

#### Durable operations and recovery

Persist immutable intent and an operation token before every shared-key create,
top-up, update, regeneration, deletion or deliberate resume. Tokens are 8–128
characters matching `[A-Za-z0-9_-]`. The SDK makes one mutation attempt. A timeout,
429, 5xx or failed response read may follow an applied effect; do not redispatch.

After the candidate lifecycle release is verified:

```ts
// Read-only recovery; never repeats the original provider write.
const operation = await proxies.poolKeys.operationByToken(persistedOperationId);
// Or, if the operation ID was received and persisted:
const sameOperation = await proxies.poolKeys.operation(savedProviderOperationId);
```

The candidate uses durable secret-free operation evidence with no TTL. Same-token
requests share immutable intent; changed payloads are rejected. Accepted,
submitted or uncertain operations remain gated through restart. This does not
replace your payment ledger, ownership checks or local delivery recovery. A
`404` lookup cannot establish that an old, pre-cutover request had no effect.

The older November 4 baseline used nominal 24-hour sequential cached replay with
concurrency and crash gaps. Do not apply the candidate guarantees to those old
requests or to an unverified serving release. See the
[release and recovery contract](../../docs/SHARED-POOL-CONTRACT.md).

After ambiguous regeneration, read the **current** scoped record with
`poolKeys.get(keyId)` and persist it encrypted. Do not regenerate again to repair
a failed local save. Historical operation `appliedVersion` and current
`credentialVersion` are different facts; another writer can change the password
after your observation. There is no fixed propagation or socket-cutoff deadline.

#### Expiry — `expiresAt` (v0.2.0+)

Ship time-bounded GB credits ("10 GB, use within 60 days") by passing an
`expiresAt` (ISO datetime or `Date`) on `create` / `update`. Past the
expiry, backend auth rejects the key and a nightly cron sets `enabled=false`.
Gateway caches and existing tunnels can delay enforcement; see Security.

```ts
// Mint with a 60-day expiry
const key = await proxies.poolKeys.create({
  label: 'customer:alice',
  trafficCapGB: 10,
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
});

// Persist intent first. Serialize expiry changes and reconcile uncertain writes.
await proxies.poolKeys.topUp(key.id, {
  addTrafficGB: 15,         // bumps cap by 15 (server $inc, no read-modify-write)
  extendDays: 60,           // expiresAt = max(now, current) + 60 days
  idempotencyKey: `topup_${invoiceId}`,
});

// Remove expiry (perpetual key) — still uses update()
await proxies.poolKeys.update(key.id, { expiresAt: null });
```

Helpers exported from the package:
```ts
import { isPoolKeyExpired, daysUntilPoolKeyExpiry } from '@proxies-sx/pool-sdk';

isPoolKeyExpired(key);              // boolean — true if past expiry
daysUntilPoolKeyExpiry(key);        // number | null — days until expiry, null if no expiry
```

The list endpoint also returns `isExpired: boolean` computed server-side
(useful in dashboards before the nightly cron has flipped `enabled`).

### `proxies.pool` (public endpoints)

| Method | Returns | Description |
|---|---|---|
| `getStock()` | `PoolStock` | Live routable endpoint count per country, plus `connected` (relay memberships, not sellable capacity), the country-tier `pricing` block, `reservedIp` terms and `ipTypes` (v0.14.0 types) |
| `getCarrierStock({ country?, pool? })` | `CarrierStock` / `CarrierStockAll` | Live routable stock by carrier/ASN — one country or the whole catalogue, `peer` / `mbl` / `all` (counts only, no exit IPs). Pair an entry's `asn` with an explicit matching `pool` in `proxies.buildProxyUrl(pakKey, { pool: 'peer', asn })` to route to that carrier. |
| `getCities(country, { pool? })` | `PoolCities` | Live routable stock by **city + region** for one country (`{ cities, regions }`, counts only). Pass `pool: 'peer'` with a `cities[].city` as `city`, or a `regions[].region` as `state`, when building the URL. Peer pool only; both are hard filters, so offer only what has stock. **(v0.13.0+)** |
| `getFacets({ country, city?, state?, carrier?, pool? })` | `PoolFacets` | **Cross-filtered** city + region + carrier facets — each list reflects the other selections, so three pickers narrow each other and stay in agreement with what the gateway will route ("city smallens carrier and vice versa"). **(v0.13.0+)** |
| `getIncidents()` | `Incident[]` | Active pool incidents — `{ id, severity, message, since }`, empty when all nominal |

### `proxies.buildProxyUrl(pakKey, opts?)`

Instance method using your configured `proxyUsername` and `gatewayHost`.

### `buildProxyUrl(proxyUsername, pakKey, opts?)`

Standalone function — use it if you don't have a client instance on hand.

```ts
import { buildProxyUrl } from '@proxies-sx/pool-sdk';
```

**`opts`:**

> **Complete token semantics — including what each filter does when nothing
> matches — live in [`docs/USERNAME-DSL.md`](../../docs/USERNAME-DSL.md).**
> Every targeting token is a hard filter on the live gateway; the DSL doc is
> the authority.

| Field | Type | Notes |
|---|---|---|
| `pool` | `'mbl' \| 'peer' \| 'any' \| 'best'` | **Set explicitly; omission defaults to `mbl`.** `'peer'` = the flagship network (~82–120 countries, mixed mobile + residential). `'mbl'` = our carrier modems, exactly 6 countries. |
| `country` | `'us' \| 'gb' \| 'fr' \| 'nl' \| 'pl' \| 'ge'` and more | Those 6 are the **`mbl`** set; `peer` spans far more. **`'ge'` is Georgia** — Germany is `'de'`, which has no `mbl` stock (`mbl-de` always fails; use `pool: 'peer'`). |
| `carrier` | `string` | `'att'`, `'tmobile'` — **hard** exact slug match on the device's carrier or ISP name, never widened. No match → `E_NO_STOCK_COUNTRY` 502. Prefer `asn` when you have it. |
| `isp` | `string` | `'tmobile'`, `'comcast'` — **hard** slugified match (peer pool). No match → `E_NO_STOCK_COUNTRY` 502. |
| `asn` | `number` | `21928` (T-Mobile) — **hard** exact match. No match → 502. Most precise; pair with `getCarrierStock()`. |
| `ipType` | `'mobile' \| 'residential' \| 'datacenter'` | **Hard** class filter, emits `-iptype-<v>`. `mbl` is mobile-only by construction, so this mainly matters for `pool: 'peer'`. Unclassified peers are excluded. No match → 502. |
| `city` | `string` | `'brooklyn'` (slug from `getCities()` / `getFacets()`) — **hard, peer-only.** No routable peer in that city → 502; modems never match, so `pool: 'mbl'` + `city` always refuses. |
| `state` | `string` | `'ca'`, `'ny'` (ISO subdivision code) — **hard, peer-only**, coarser than `city`. No routable peer in that region → 502; refuses on `mbl`. Discover with `getCities().regions` / `getFacets().states`. **(v0.13.0+)** |
| `sid` | `string` | Session name, `[a-z0-9_]{1,64}`, **no hyphens** — validated at build time (throws `ProxiesConfigError`). **Required for `sticky`/`auto*` to persist across connections.** A sid *alone* is not sticky — with no `rotation` you still get the gateway default `auto10`. |
| `rotation` | `'none' \| 'auto5' \| 'auto10' \| 'auto20' \| 'auto60' \| 'ondemand' \| 'sticky' \| 'hard'` | `'sticky'` pins the **device** and weights IP-stability. `'hard'` **pins like sticky** — NOT a new IP per request. **`'none'` emits no token, so the gateway default `auto10` applies (~10 min)** — it is not "no rotation". Needs a `sid` to persist. |
| `strict` | `boolean` | Emits the bare `-strict` flag. Only active with `'sticky'`/`'hard'`: adds a hard IP-stability floor and heavier stability weighting. No-op for `auto*`/`ondemand`. |
| `failover` | `'any' \| 'samecountry' \| 'samecarrier' \| 'samenode' \| 'strict'` | Substitution scope when the chosen endpoint is unavailable. `'samecountry'` is the gateway default and is omitted from the URL. `'strict'` disables substitution and fails clean. |
| `ttl` | `number` (seconds) | Session-row lifetime, clamped 60 – 2,592,000. **Immutable for a live `sid`** — changing it does nothing until that row expires; use a new `sid`. Not an IP-hold guarantee. |
| `pin` | `{ type: 'lease' \| 'device' \| 'port'; id: string }` | Pin one endpoint. Use `'lease'` for [Reserved IPs](../../docs/RESERVED-IPS.md) — it survives rotation; `'device'` bakes a mutable id into the credential. `id` is validated (`[a-z0-9_]{1,64}`) because the gateway does **not** sanitize it: a stray `-` truncates the token and the pin silently resolves to nothing. |
| `protocol` | `'http' \| 'socks5'` | `'http'` (port 7000) or `'socks5'` (port 7001) |
| `host` | `string` | Override gateway host, e.g. `'edge-eu.proxies.sx'` |

**Sticky is a binding preference, not a reservation or immutable IP.** Endpoint
failover and the device's own network can change the result. `strict` adds its
documented stability filter, not an address guarantee. A
[Reserved IP](../../docs/RESERVED-IPS.md) is a separate product contract. See
[wiki: Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation).

```ts
// The strongest IP-hold this DSL can express
const url = proxies.buildProxyUrl(pakKey, {
  pool: 'peer',
  country: 'us',
  sid: 'cust_8f3a21bd',
  rotation: 'sticky',
  strict: true,
});
// → "http://psx_abc123-peer-us-sid-cust_8f3a21bd-rot-sticky-strict:pak_…@gw.proxies.sx:7000"

// A Reserved IP — pinned by lease, survives rotation
const reserved = proxies.buildProxyUrl(pakKey, {
  pool: 'peer',
  country: 'us',
  sid: 'res01',
  rotation: 'sticky',
  pin: { type: 'lease', id: 'l23d4e83c5b' },
});
```

**Prove it routes before shipping it** — a URL that compiles is not a URL that
authenticates:

```bash
curl -x "http://<username>:<pak>@gw.proxies.sx:7000" https://api.ipify.org
```

#### Carrier / ASN / mobile-vs-residential discovery

`getCarrierStock()` is the live catalogue behind a carrier picker. Every entry
carries an `ipType`, so this is also how you offer **mobile vs residential**
without hardcoding anything. Counts only — never exit IPs.

Scope it on two independent axes:

| | omit `country` | pass `country` |
|---|---|---|
| **`pool: 'peer'`** (also the discovery default) | full catalogue, every country | one country, peer |
| **`pool: 'mbl'`** | all 6 modem countries | one country, modems |
| **`pool: 'all'`** | full catalogue, both pools merged | one country, both |

```ts
// FULL carrier list across every country, in one call
const all = await proxies.pool.getCarrierStock({ pool: 'peer' });
// → { pool: 'peer', updatedAt, countries: {
//     US: { total: 265, other: 41, carriers: [
//       { asn: 7922,  name: 'Comcast',  ipType: 'residential', count: 63 },
//       { asn: 21928, name: 'T-Mobile', ipType: 'mobile',      count: 9  }, … ] },
//     GB: { … }, … } }        // ~122 countries

// One country, both pools
const us = await proxies.pool.getCarrierStock({ country: 'us', pool: 'all' });
// → { pool: 'all', country: 'US', total, other, carriers: [ … ] }

// The modem tier — every entry is ipType 'mobile', 6 countries
const modems = await proxies.pool.getCarrierStock({ pool: 'mbl' });
```

**Detecting mobile vs residential** — filter on `ipType`, then route with the
entry's `asn`:

```ts
const us = await proxies.pool.getCarrierStock({ country: 'us', pool: 'all' });

const mobile      = us.carriers.filter((c) => c.ipType === 'mobile');
const residential = us.carriers.filter((c) => c.ipType === 'residential');

// Route to a chosen carrier — pair the entry's asn. Set `pool` explicitly:
// buildProxyUrl defaults to 'mbl', so peer ASNs need `pool: 'peer'` (or 'best').
const url = proxies.buildProxyUrl(pakKey, { pool: 'peer', country: 'us', asn: mobile[0].asn! });
// → "http://psx_abc123-peer-us-asn-21928:pak_…@gw.proxies.sx:7000"
//   (or isp: 'tmobile' for a name-prefix match)
```

Prefer `asn` over `isp` when you have it: `asn` is an exact match, `isp` is a
slugified prefix match. Both are **hard** filters — if nothing matches, the
gateway returns `E_NO_STOCK_COUNTRY` (502). So are `carrier`, `city` and
`state`; nothing is widened on a retry.

Want the whole network split by access type in one pass:

```ts
const all = await proxies.pool.getCarrierStock({ pool: 'all' });

const byType = { mobile: 0, residential: 0, datacenter: 0 } as Record<string, number>;
for (const c of Object.values(all.countries)) {
  for (const carrier of c.carriers) {
    byType[carrier.ipType] = (byType[carrier.ipType] ?? 0) + carrier.count;
  }
}
// → { residential: 1872, mobile: 938, datacenter: 0 }   (live, 2026-07-28)
```

> Counts are real-time routable supply, cached ~30s server-side. Small pools are
> normal for residential ASNs. **Check depth before you sell a country** — a
> country with a handful of endpoints is unreliable no matter how it's
> configured, and `pool.getStock()` gives you the per-country totals to gate on.
>
> `getCarrierStock('us')` (bare string) still works and is equivalent to
> `{ country: 'us' }` — it is deprecated but not removed. New code should pass
> `{ country: 'us', pool: 'peer' }` explicitly and choose the same pool in URLs.

---

## Complete end-to-end example (Next.js App Router)

```ts
// app/api/stripe/webhook/route.ts
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { ProxiesClient } from '@proxies-sx/pool-sdk';
import { db } from '@/lib/db';

const stripe = new Stripe(process.env.STRIPE_SECRET!);
const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY!,
  proxyUsername: process.env.PROXIES_SX_USERNAME!,
});

export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')!;
  const body = await req.text();
  const event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const customerId = session.client_reference_id!;
    const gbPurchased = Number(session.metadata?.gb ?? '0');

    // Mint the key with a cap matching what they bought
    const key = await proxies.poolKeys.create({
      label: `customer:${customerId}`,
      trafficCapGB: gbPurchased,
    });

    await db.customers.update(customerId, { pakKeyId: key.id, pakKey: key.key });
  }
  return NextResponse.json({ received: true });
}
```

```tsx
// app/dashboard/page.tsx
import { ProxiesClient } from '@proxies-sx/pool-sdk';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export default async function DashboardPage() {
  const user = await auth();
  const customer = await db.customers.get(user.id);

  const proxies = new ProxiesClient({
    apiKey: process.env.PROXIES_SX_API_KEY!,
    proxyUsername: process.env.PROXIES_SX_USERNAME!,
  });

  const key = await proxies.poolKeys.get(customer.pakKeyId); // read — don't write to read
  const url = proxies.buildProxyUrl(customer.pakKey, {
    pool: 'peer',
    country: 'us',
    sid: customer.id,   // required for stickiness to persist across connections
    rotation: 'sticky',
  });

  return (
    <div>
      <h1>Your Proxy</h1>
      <pre>{url}</pre>
      <p>Used {key.trafficUsedGB?.toFixed(2)} GB of {key.trafficCapGB} GB</p>
    </div>
  );
}
```

---

## Error handling

All errors extend `ProxiesError`. Use `instanceof` for type narrowing:

```ts
import { ProxiesApiError, ProxiesTimeoutError } from '@proxies-sx/pool-sdk';

try {
  await proxies.poolKeys.create({ label: 'test', trafficCapGB: 1 });
} catch (err) {
  if (err instanceof ProxiesApiError) {
    // err.requestId is the X-Request-ID server-side — paste it in support tickets
    logger.error({ status: err.status, requestId: err.requestId, body: err.body });

    if (err.isAuth) {
      // 401/403 — API key invalid or revoked
    } else if (err.isRateLimited) {
      // Reads may retry 429; mutations need outcome reconciliation.
    } else if (err.isServer) {
      // A mutation may have applied despite 5xx; do not automatically replay.
    }
  } else if (err instanceof ProxiesTimeoutError) {
    // Request exceeded the configured timeout
  }
  throw err;
}
```

---

## Security

- **Never** ship `PROXIES_SX_API_KEY` to the browser. The SDK is designed for server-side use (API routes, server components, webhooks, cron).
- The only truly browser-safe export is the standalone `buildProxyUrl()` — and even then, only call it once you've fetched the specific customer's `pak_` from *your own* backend.
- For a leaked key, perform an authorized regeneration through a durable operation. Gateway authentication caches, outage grace and periodic tunnel rechecks can delay enforcement. Source defaults of 30 seconds for auth cache, 60 seconds for tunnel rechecks and 15 minutes for outage grace are implementation settings, not a verified revocation deadline. Binding release (`sessions.closeAll`) does not terminate sockets. After response loss, recover the current scoped key without regenerating again; a cached historical response can hold an obsolete password.
- Each `pak_` key is scoped to your reseller account. A leaked key can only consume traffic from *your* GB pool, not from other resellers.

---

## Typing + runtime compatibility

- Ships ESM (`import`) and CJS (`require`) + full `.d.ts` types
- Zero dependencies at runtime
- Works in Node 18.17+, Bun, Deno (with `npm:` specifier), Vercel Edge, Cloudflare Workers
- Pass `fetch` in config if your runtime lacks global `fetch`

---

## Not using JavaScript? Call the REST API directly

This SDK is a thin wrapper around a public REST API. Any language with an HTTP client can integrate — PHP, Python, Ruby, Go, Rust, Elixir, even bash + curl.

**Auth header:** `X-API-Key: psx_...` (mint at [client.proxies.sx/account](https://client.proxies.sx/account)).

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/reseller/pool-keys` | Mint a `pak_` key for a customer |
| `GET` | `/v1/reseller/pool-keys` | List your keys with usage |
| `GET` | `/v1/reseller/pool-keys/:keyId` | Fetch a single key (v0.3.0+) |
| `PATCH` | `/v1/reseller/pool-keys/:keyId` | Update label / cap / enabled / expiresAt |
| `POST` | `/v1/reseller/pool-keys/:keyId/topup` | Atomic cap increment; expiry uses a prior read (serialize changes) |
| `POST` | `/v1/reseller/pool-keys/:keyId/regenerate` | Rotate the stored secret; propagation has no promised fixed cutoff — see [Security](#security) |
| `POST` | `/v1/reseller/pool-keys/:keyId/reveal` | Audit-logged unmask |
| `GET` | `/v1/reseller/pool-keys/audit` · `/:keyId/audit` | 90-day forensic log (all keys / one key) |
| `GET` | `/v1/reseller/pool-keys/:keyId/usage?days=30` | Per-day MB series for one key |
| `GET` | `/v1/reseller/analytics/pak-usage?days=30` | Daily GB across all keys + per-key breakdown (`traffic:read`) |
| `DELETE` | `/v1/reseller/pool-keys/:keyId` | Remove key; not immediate socket termination |
| `GET` | `/v1/reseller/pool-keys/operations/lookup` | Candidate: read operation by saved `Idempotency-Key` header |
| `GET` | `/v1/reseller/pool-keys/operations/:operationId` | Candidate: read secret-free operation state |
| `POST` | `/v1/reseller/pool-keys/:keyId/resume` | Candidate: `{ expectedLifecycleVersion }`, operation token header; sole cap hold only |

**Recovery:** persist `Idempotency-Key` before shared-key mutations and make one
dispatch. The candidate durable journal adds read-only operation lookup and
conditional resume; see [the release table and HTTP contract](../../docs/SHARED-POOL-CONTRACT.md).
Session release uses its observed generation, not the lifecycle journal. Do not
apply candidate guarantees to older releases or pre-cutover requests.

**Request correlation:** every response carries `X-Request-ID`. Paste this
in support tickets; it's how we look up your request server-side.

**Mint a key with curl:**

```bash
curl -X POST https://api.proxies.sx/v1/reseller/pool-keys \
  -H "X-API-Key: psx_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"customer:alice@example.com","trafficCapGB":10}'

# Response:
# { "id": "...", "key": "pak_...", "label": "...", "trafficCapGB": 10, ... }
```

**The proxy URL itself is plain HTTP Basic auth** — works with any HTTP/SOCKS5 client in any language. The username carries optional config tokens, and **the `pak_` is the password, never the username**:

```
http://psx_RESELLER_USERNAME-peer-us-sid-alice_session1-rot-sticky:pak_CUSTOMER_KEY@gw.proxies.sx:7000
       └──────────────── username ────────────────────────────────┘ └── password ──┘
```

Token summary (separated by `-`) — **full reference, including what each filter
does when nothing matches, in [`docs/USERNAME-DSL.md`](../../docs/USERNAME-DSL.md)**:

- `peer` / `mbl` / `any` — pool. `peer` is the flagship network (~82–120 countries); `mbl` is our carrier-modem tier, exactly `us` `gb` `fr` `nl` `pl` `ge`. **`ge` is Georgia**; Germany is `de` and has no `mbl` stock.
- `sid-<id>` — session name, `[a-z0-9_]{1,64}`, no hyphens. **Required for stickiness to persist across connections**, but not sufficient on its own. The canonical token is `sid`; the gateway rewrites `-session-<id>` to it.
- `rot-sticky` / `rot-auto5|10|20|60` / `rot-ondemand` / `rot-hard` — `sticky`/`hard` pin the **device** (`hard` ≡ `sticky`, NOT a new IP per request); `auto*` re-pick every N min; `ondemand` re-picks a different endpoint on every new connection (with a `sid`). **Omit the token and the gateway default `auto10` applies** — omitting is not "no rotation".
- `strict` — bare flag; hardens `sticky`/`hard` with an IP-stability floor.
- `iptype-<class>` / `isp-<slug>` / `asn-<n>` / `carrier-<name>` — **hard** filters; no match returns 502.
- `city-<slug>` / `state-<code>` — **hard, peer-only**; no match returns 502 and they always refuse on `mbl`.
- `failover-<policy>` / `ttl-<seconds>` / `pin-<type>-<id>` — substitution scope, session-row TTL (immutable once the session exists), and endpoint pinning.

### Examples in other languages

**Python (with `requests`):**
```python
import requests

resp = requests.post(
    "https://api.proxies.sx/v1/reseller/pool-keys",
    headers={"X-API-Key": "psx_YOUR_API_KEY"},
    json={"label": "customer:alice", "trafficCapGB": 10},
)
key = resp.json()["key"]  # "pak_..."

# Use it as a proxy:
proxies = {
    "http":  f"http://psx_RESELLER-mbl-us-sid-alice_session1-rot-sticky:{key}@gw.proxies.sx:7000",
    "https": f"http://psx_RESELLER-mbl-us-sid-alice_session1-rot-sticky:{key}@gw.proxies.sx:7000",
}
r = requests.get("https://api.ipify.org", proxies=proxies)
```

**PHP (with Guzzle or cURL):**
```php
$ch = curl_init('https://api.proxies.sx/v1/reseller/pool-keys');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'X-API-Key: psx_YOUR_API_KEY',
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode(['label' => 'customer:alice', 'trafficCapGB' => 10]),
]);
$key = json_decode(curl_exec($ch), true)['key']; // pak_...
```

**Go:**
```go
req, _ := http.NewRequest("POST", "https://api.proxies.sx/v1/reseller/pool-keys",
    strings.NewReader(`{"label":"customer:alice","trafficCapGB":10}`))
req.Header.Set("X-API-Key", "psx_YOUR_API_KEY")
req.Header.Set("Content-Type", "application/json")
resp, _ := http.DefaultClient.Do(req)
```

**Ruby:**
```ruby
require 'net/http'; require 'json'
uri = URI('https://api.proxies.sx/v1/reseller/pool-keys')
req = Net::HTTP::Post.new(uri, 'X-API-Key' => 'psx_YOUR_API_KEY', 'Content-Type' => 'application/json')
req.body = { label: 'customer:alice', trafficCapGB: 10 }.to_json
resp = Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |h| h.request(req) }
```

**Spec:** the endpoint table above is the complete pool-keys surface. The public
reseller spec at [api.proxies.sx/v1/reseller/docs/openapi](https://api.proxies.sx/v1/reseller/docs/openapi)
(LLM companion: `/v1/reseller/docs/llm`) covers the sub-account / port / pricebook /
webhook / analytics surface and does not list these routes; the interactive Swagger
UIs (`/docs/api`, `/docs/seller`) answer `401` anonymously. Also public:
[api.proxies.sx/docs/gateway](https://api.proxies.sx/docs/gateway) (Pool Gateway API —
Private Pool leases, x402 pool; JSON at `/docs/gateway-json`).

---

## Development

```bash
git clone https://github.com/bolivian-peru/proxy-reseller-kit
cd proxy-reseller-kit
pnpm install
pnpm -r --filter @proxies-sx/pool-sdk test
pnpm -r --filter @proxies-sx/pool-sdk build
```

---

## License

MIT — see [LICENSE](../../LICENSE).
