# Changelog — `@proxies-sx/pool-sdk`

## 0.8.0

- **Pool model clarified.** `peer` is the **community SDK network** (mixed mobile + residential
  home/ISP IPs) — no longer mislabeled "residential only". Added `any`/`best` to the `Pool` type
  and the `<PoolSessionSpawner>` pool picker.
- **Per-pool country stock.** Docs + components clarify that country availability differs by pool;
  filter the country picker by the selected pool (`countries[CC].modem` / `.peer`).
- Throughput-floor note (`PEER_THROUGHPUT_FLOOR_KBPS` ~500 KB/s) added to the guide.


All notable changes to this package are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
semver from 0.3.0 onwards (the public surface is everything exported from
`dist/index.d.ts`).

> **npm registry latest: `0.5.1`.** The current **`0.6.0`** build is distributed
> as a GitHub release tarball ([v0.6.1](https://github.com/bolivian-peru/proxy-reseller-kit/releases/tag/v0.6.1))
> until it is published to npm:
> ```bash
> npm i https://github.com/bolivian-peru/proxy-reseller-kit/releases/download/v0.6.1/proxies-sx-pool-sdk-0.6.0.tgz
> ```

## 0.6.1 — Sticky semantics docs (sticky smart-selection, May 2026)

Documentation-only release that brings the SDK's `RotationMode` TSDoc and
README into alignment with the gateway-side change in #295 Phase 1.

### Changed

- **`RotationMode` TSDoc** — explicitly documents that `sticky` and `hard` now
  trigger gateway-side **IP-stability-aware modem selection** (50% weight on
  `ipStabilityScore` in the Lua selector). Previous text "same IP for session
  duration" was misleading because it implied a guarantee the carrier doesn't
  give us. New text explains that sticky pins the MODEM (not the IP), the
  gateway picks the most IP-stable modem, and customers needing a TRULY
  immutable IP should use the residential `peer` pool.
- **README rotation table** — adds `auto5` / `auto20` / `auto60` / `ondemand`
  to the rotation modes list (they were always supported, just not enumerated)
  and links to the wiki "Sticky Sessions and Rotation" page.
- **`buildProxyUrl` example comment** — clarified to mention smart-selection
  and CGNAT caveat.

### Wire-compatible

No runtime change to `buildProxyUrl()` output. SDK callers don't need to do
anything — sticky behavior at the gateway is automatically smarter for every
existing `pak_` minted by this SDK.

### Background

See gb-system-api commit `e4d5bb5e` for the gateway-side blip-grace fix and
the matching `ipStabilityScore` smart-select work. Customer portal copy +
wiki "Sticky Sessions and Rotation" page also updated.

## 0.6.0 — Per-customer session scoping (`{ pakId }`) [released via GitHub tarball v0.6.1]

Finalizes the multi-tenant session fix drafted in 0.5.2 with an explicit,
typed scoping argument instead of a positional one.

### Added / Changed

- **`sessions.list({ pakId })` / `close(key, { pakId })` / `closeAll({ pakId })`** —
  all three session methods now take an options object with a `pakId` (a
  customer's Pool Access Key id or `pak_` value). When passed, the platform
  filters/verifies ownership at the **end-customer** level, not just the API-key
  owner. Called with no argument, behavior is unchanged (account-wide).
- **`ActiveSession.pakKeyId`** — sessions now carry the owning key id, so a
  dashboard can attribute each session to a customer.
- Supersedes 0.5.2's positional `list(pakKey)` shape (which never shipped to
  npm). `@proxies-sx/pool-portal-react` 0.6.1 threads `getUserKeyId` into every
  session route on top of this.

## 0.5.2 — Multi-tenant session-scoping fix [superseded by 0.6.0, never published]

Closes a cross-customer data leak in `client.sessions.list()` when the
SDK is used by multi-tenant resellers (one `psx_` API key, many
`pak_` end-customers).

### Fixed

- **`client.sessions.list()` cross-customer leak** — previously called
  `/v1/gateway/pool/my-sessions` with no scope, which on the platform
  side filters by the API-key owner (the reseller), not the end-customer.
  In a reseller dashboard, that meant customer A could see every other
  customer's live sessions through the same `<ActiveSessionsTable />`.
  The method now takes an optional `pakKey` argument that's forwarded
  as `?pakId=` — pass your end-customer's `pak_` value to scope the
  list to just their sessions.

### Changed

- **`client.sessions.list(pakKey?: string)`** — new optional argument.
  Backwards compatible: existing single-tenant callers (your own app
  using one API key for your own usage) work unchanged.
- **`client.sessions.close(sessionKey)` and `closeAll()`** — no signature
  change, but the docstrings now make clear that upstream ownership is
  enforced at the API-key level. Multi-tenant callers MUST list first
  with `pakKey` and only close session keys that appeared there.

### Recommended upgrade path for resellers

1. Bump to `^0.5.2`.
2. In your customer dashboard backend, pass the customer's `pak_` value
   to `sessions.list(pak)`.
3. If you use `@proxies-sx/pool-portal-react`'s `createPoolApiHandlers`,
   upgrade that to `0.5.2` as well — it does the scoping for you.

Reported during a live debug session 2026-05-14 with a reseller whose
customer dashboard was returning the wrong customer's sessions.

## 0.5.1 — server-side improvements (no SDK change required)

The platform shipped a new pool-reconciliation subsystem on 2026-05-04
(commit `8df63a49` on the `gb-system-api` repo). It runs every 5 min,
diffs MongoDB↔Redis, evicts orphans, and triggers re-scans for
missing endpoints. Server delete/disable now cascades to the pool
within seconds instead of up to 2 min.

**SDK impact: zero.** `client.pool.getStock()` calls the same endpoint
(`/v1/gateway/pool/stock`) which now returns status-aware counts —
stale ghost endpoints from deleted servers are filtered out at the
source. Existing integrations get more accurate numbers automatically;
no version bump required.

If you want to debug "why is country X showing N peers/modems?", the
new `/v1/admin/pool/diff` endpoint (admin-only, not in SDK) returns
the live expected-vs-actual diff. Reach out if you need access.

## 0.5.0 — Pool Access Key security hardening

Tracks the platform's May 2026 pak_ security update. Three new endpoints,
zero behavioral changes for existing methods. Companion docs:
[POOL-ACCESS-KEYS.md](https://github.com/bolivian-peru/gb-system-api/blob/master/POOL-ACCESS-KEYS.md)
on the platform side.

### Added

- **`client.poolKeys.reveal(keyId): Promise<PoolAccessKey>`** —
  audit-logged unmask. Returns the same payload as `get()` but the
  platform records a `reveal` event with the caller's IP / UA / request
  id. Use in your customer-facing dashboards instead of displaying the
  raw `key` from `list()` — gives forensic visibility for compromise
  investigations. Stripe / GitHub / AWS-style credential UX.

- **`client.poolKeys.audit(opts?): Promise<PoolAccessKeyAuditEvent[]>`** —
  forensic log across ALL of your pak_ keys. Supports `{ action?, before?, limit? }`.
  90-day TTL on the platform; archive to your own SIEM if needed.
  Useful for support tooling, fraud detection, billing-dispute resolution.

- **`client.poolKeys.auditForKey(keyId, opts?): Promise<PoolAccessKeyAuditEvent[]>`** —
  same shape, scoped to one key. Good for "my customer says their key
  stopped working" investigations.

- **`PakAuditAction`** type — union of recorded action names:
  `'create' | 'update' | 'topup' | 'regenerate' | 'reveal' | 'delete' |
  'gateway_auth_success' | 'gateway_auth_failure' |
  'auto_suspended_cap_exceeded' | 'auto_suspended_expired'`.

- **`PoolAccessKeyAuditEvent`** type — `{ id, pakId?, action, ip, userAgent,
  requestId, authMethod, metadata, createdAt }`.

- **`AuditQueryOpts`** type for `audit()` / `auditForKey()` opts.

### Behavior change to be aware of (server-side, not SDK)

- **Auto-suspend on cap exceeded.** The platform now atomically flips
  `enabled = false` when a key's `trafficUsedMB / 1024 ≥ trafficCapGB`.
  This is intentional — caps financial blast radius if a key leaks.
  **`topUp()` does NOT auto re-enable.** If your auto-topup flow
  (e.g., Stripe webhook) tops up a customer who hit their cap, you
  must explicitly re-enable:

  ```ts
  await proxies.poolKeys.topUp(keyId, { addTrafficGB: 10 });
  await proxies.poolKeys.update(keyId, { enabled: true });
  ```

  This is by design: forces a deliberate decision per top-up so a
  leaked key can't auto-recover from a cap suspend without owner
  review. The starter app's Stripe webhook (`apps/starter/src/app/api/stripe/webhook/route.ts`)
  has been updated to the new pattern in 0.5.0.

### FreshAuthGuard (server-side, not SDK)

The platform now requires recent auth (JWT < 5 min OR
`X-Confirm-Password` header) for `POST /pool-keys` (mint) and
`POST /:keyId/regenerate`. **`psx_` API-key callers bypass this
entirely** — your server-to-server SDK calls see zero behavior change.
Don't add `X-Confirm-Password` from server code. Compensating controls:
per-key rate limit + audit log on every mutation.

### Backwards compatibility

Fully additive on the SDK surface. Existing calls behave identically.
The auto-suspend behavior change is technically a server-side
behavioral change but only affects the small subset of integrations
that auto-topup an over-cap key without explicit re-enable.

## 0.4.0 — Sessions API (multi-port spawner UX)

Coronium audit follow-up (2026‑05‑01): expose live gateway session
state so resellers can build the same multi-port spawner / active-
sessions-table UX as `client.proxies.sx/pool-proxy`.

### Added

- **`client.sessions` namespace** with three methods:
  - `list(): Promise<{ sessions: ActiveSession[]; count }>` — current
    user's live sessions, with `proxyUrl` and `socks5Url` template
    strings (`<PASSWORD>` placeholder for client-side substitution).
  - `close(sessionKey): Promise<{ success, message }>` — close one
    session. Idempotent + ownership-checked server-side.
  - `closeAll(): Promise<{ success, count }>` — close all live sessions
    for the current user. Use sparingly — kills every live connection.
- **`ActiveSession` type** with full session metadata: `country`,
  `pool`, `currentIp`, `bytesIn`/`bytesOut`, `requestCount`, `ttl`,
  `proxyUrl`, `socks5Url`, `isSynthesizedSid`, etc.
- **`ActiveSessionsResponse`** (`{ sessions, count }`) export.

### Fixed (gateway-side, accompanies this SDK)

- **Phantom-session TTL** — sessions created without an explicit `-sid-`
  token (synthesized `auto_*`/`socks5_*` ids) now expire after 5 min
  instead of 1 hour. They were filling up the active-sessions list with
  ad-hoc-curl noise. Real customer sessions (with `-sid-`) keep their
  full TTL. The SDK exposes this as `session.isSynthesizedSid: true`
  so dashboards can hide them.

### Backwards compatibility

Additive only. Existing `poolKeys.*`, `pool.*`, retry, idempotency,
`topUp()`, `get()` all unchanged. Bump `^0.3.1` → `^0.4.0` to use the
new `sessions` namespace.

---

## 0.3.1 — PoolStock shape fix (P0)

Surfaced by Coronium's live integration audit (2026‑05‑01). The
declared `PoolStock` type in `dist/index.d.ts` was unrelated to what
the running production server returns — every consumer iterating
`stock.countries` got `undefined`. Fixed.

### Fixed

- **`PoolStock` now matches the live `GET /v1/gateway/pool/stock` shape**:
  ```ts
  {
    pools: { mbl: Record<string,number>, peer: Record<string,number> },
    totals: { mbl: number, peer: number, all: number },
    generatedAt: string,
  }
  ```
  Previous (wrong) shape was `{ updatedAt, countries: [{ country, mbl, peer }] }`.
- **Runtime validator on `pool.getStock()`** — if the server response
  doesn't carry `pools`, `totals`, and `generatedAt`, the SDK throws
  a typed `ProxiesError` instead of returning bogus data.

### Added

- `KnownCountry` widened to include `'ch' | 'pa' | 'am'` (seen in live
  peer-pool snapshots). `Country` is unchanged (`KnownCountry | (string & {})`)
  so future country additions still work without an SDK bump.
- Snapshot tests locking the new shape against a real production
  response, plus a regression test that asserts the old shape is
  rejected.

### Migration

If you were already reading `stock.pools` and `stock.totals` directly
(via `as any`), you can now drop the cast — the types are correct.
If you were reading `stock.countries`, that path was always broken;
move to `Object.entries(stock.pools.mbl)` for per-country mobile
counts (or `peer` for residential).

---

## 0.3.0 — Production-readiness pass

Driven by paying-reseller feedback (Coronium audit, 2026‑04‑30). Removes the
need for host-app retry wrappers and locks down the double-mint footgun on
write retries.

### Added

- **Built-in retry + exponential backoff with full jitter.** Configurable via
  `ClientConfig.retry: false | { attempts, baseDelayMs, maxDelayMs }`.
  Defaults to 3 attempts, 250ms / 1s / 4s. Fires on `5xx`, `429`, timeouts,
  and network-level errors. Honors `Retry-After` (seconds and HTTP-date).
  Skips `4xx` (except `429`).
- **`Idempotency-Key` support on writes.** Pass `idempotencyKey` on
  `poolKeys.create()`, `poolKeys.topUp()`, `poolKeys.regenerate()`. The
  platform dedupes within a 24h window — retried calls with the same key
  return the cached response instead of creating a second resource.
- **`ProxiesApiError.requestId`.** Populated from the `X-Request-ID` response
  header. Paste it in support tickets to skip log-grepping.
- **`poolKeys.topUp(keyId, { addTrafficGB?, extendDays?, idempotencyKey? })`.**
  Atomic single-write: cap `$inc`-ed server-side; expiresAt extended from
  `max(now, current_expiresAt) + days` (never shortens). Replaces the
  read-modify-write pattern over `update()`.
- **`poolKeys.get(keyId)`.** Single-record fetch. Avoids `list()` + filter
  on large fleets.
- **`KnownCountry` type** — literal union of currently-supported countries
  for IDE autocomplete. `Country` is now `KnownCountry | (string & {})` so
  forward-compatible without breaking the autocomplete experience.
- **`ProxiesApiError.isRetryable`** getter — `true` for `429`/`5xx`. Useful
  if you've disabled SDK retries.
- **`RetryConfig` exported type.**
- **`TopUpPoolAccessKeyInput` exported type.**

### Changed

- **`poolKeys.regenerate()` now returns the full `PoolAccessKey` record**
  (was: `{ id, key }`). The original two fields are still present, so
  call sites destructuring `{ id, key }` continue to work.
- **`RotationMode` JSDoc** rewritten with concrete gateway-level behavior
  for `none` / `auto10` / `auto30` / `sticky` / `hard`.

### Backwards compatibility

- Adding fields only. No removals, no renames.
- Default retry on means previously-throwing transient `5xx`/`429` calls
  now resolve after backoff. If you had your own retry wrapper, **delete
  it** — combining retries causes thundering herd.
- If your host app threw on transient errors and you depended on that
  for fast-fail, set `retry: false` in the constructor to restore the
  prior behavior.

## 0.2.0

- Added `expiresAt` on `PoolAccessKey`.
- Added `isPoolKeyExpired()` and `daysUntilPoolKeyExpiry()` helpers.
- Added `isExpired` server-computed flag on responses.
- `<PoolPortal>` (companion `@proxies-sx/pool-portal-react` 0.2.0) renders
  expiry banners.

## 0.1.0

- Initial release. Mint / list / update / regenerate / delete pool keys;
  build proxy URLs; pool stock + incident feeds.
