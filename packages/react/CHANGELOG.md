# Changelog — `@proxies-sx/pool-portal-react`

All notable changes to this package are documented here.

> **npm registry latest: `0.5.1`.** The current **`0.6.1`** build is distributed
> as a GitHub release tarball ([v0.6.1](https://github.com/bolivian-peru/proxy-reseller-kit/releases/tag/v0.6.1))
> until it is published to npm. Installing it pulls `pool-sdk@0.6.0` automatically:
> ```bash
> npm i https://github.com/bolivian-peru/proxy-reseller-kit/releases/download/v0.6.1/proxies-sx-pool-portal-react-0.6.1.tgz
> ```

## 0.6.1 — Session routes scoped via `getUserKeyId` (`{ pakId }`) [released via GitHub tarball v0.6.1]

Depends on `@proxies-sx/pool-sdk@^0.6.0`. Completes the multi-tenant session
fix end-to-end: `createPoolApiHandlers()` now threads the per-request
`getUserKeyId` into **every** session route, so customers only ever see and
close their own sessions — no host-side wrapper needed.

### Fixed / Changed

- **`handleListSessions` / `handleCloseSession` / `handleCloseAllSessions`** now
  resolve the caller's key id via `getUserKeyId` and pass it as `{ pakId }` to
  the SDK. A user with no key gets an empty list / no-op close (never an unscoped
  account-wide call). Supersedes 0.5.2's client-side ownership re-check.
- **`<PakQuickstart>`** added — minimal copy-the-proxy-string onboarding block.
- After upgrading to `^0.6.1`, remove any `/my-sessions` route-layer lockdown you
  added for 0.5.x and re-enable `<ActiveSessionsTable>`.

## 0.5.2 — Cross-customer session-scoping fix [superseded by 0.6.1, never published]

Closes a multi-tenant data-leak + privilege issue in the session route
handlers exposed by `createPoolApiHandlers()`. Affects any reseller
using `<PoolPortal>` (or its `<ActiveSessionsTable>` subcomponent) to
serve multiple end-customers behind one `psx_` API key.

### Fixed (cross-customer)

- **`handleListSessions`** (`GET /api/pool/my-sessions`) — previously
  called `proxies.sessions.list()` with no scope. Upstream filters by
  the API-key owner = the RESELLER, not the customer. End result:
  customer A logging into the reseller's dashboard saw every other
  customer's live sessions in `<ActiveSessionsTable>`. The handler now
  resolves the calling customer's `pak_` first and passes it as
  `sessions.list(pakKey)` so only that customer's sessions are returned.

- **`handleCloseSession`** (`DELETE /api/pool/my-sessions/:sessionKey`)
  — upstream ownership check is at API-key level only. A customer who
  discovered another customer's `sessionKey` could close it. Handler
  now lists the customer's own scoped sessions first and refuses any
  `sessionKey` that doesn't appear there (returns 404).

- **`handleCloseAllSessions`** (`DELETE /api/pool/my-sessions`) —
  previously called `sessions.closeAll()`, which closes every session
  under the API-key owner — i.e. EVERY customer of the reseller in a
  single click. Replaced with a per-session loop scoped to the
  calling customer's pak. Audit event `sessions.closed_all` still
  fires with the actual count closed.

### Changed

- **Dependency** `@proxies-sx/pool-sdk: ^0.5.1 → ^0.5.2` (needed for
  the new optional `pakKey` arg on `sessions.list`).

### Performance

- The session routes now do one extra `poolKeys.get(keyId)` round-trip
  per call to resolve the customer's `pak_`. This is acceptable —
  session-routes are user-initiated and infrequent. If the per-session
  ownership re-check becomes a hot path for high-customer-count
  resellers, a future version may cache pak resolution in-process.

Reported and patched during a live debug session 2026-05-14.

## 0.5.0 — SDK 0.5.0 bump + server.ts get() fix

Tracks SDK 0.5.0 (Pool Access Key security hardening) — bump dependency
to `^0.5.0` so apps consuming this package can use the new
`reveal` / `audit` / `auditForKey` methods on `ProxiesClient` directly.

### Changed

- **Dependency** `@proxies-sx/pool-sdk: ^0.4.0 → ^0.5.0`. Existing
  components don't use the new methods themselves; the bump unblocks
  consumers who want to.

### Fixed

- **`createPoolApiHandlers().handleMe`** now calls `proxies.poolKeys.get(keyId)`
  instead of the legacy `list().find()` workaround. The previous comment
  claimed the SDK had no single-key GET — stale since 0.3.0. Behavior
  preserved (404 returns `{ error: 'key_missing', status: 404 }`).

### NOT changed (deliberate)

- **`<PoolPortal>` still serves the full `pak_` value via `MeResponse.pakKey`.**
  This is the customer's own credential — they need it to use the proxy.
  Different from the reseller-management pattern (mask + reveal-on-demand
  for many keys). If you're building a reseller dashboard on top of this
  SDK, use `client.poolKeys.reveal()` instead of displaying `key` from `list()`.

## 0.4.1 — Pool docs panel + live stock grid

Driven by Coronium's customer-page redesign request: drop in a
technical reference + live country stock with one component each.

### Added

- **`<PoolDocsPanel>`** — drop-in technical reference. Four sections:
  How-it-works (5-step request flow diagram), Username token reference
  (full DSL grammar), IP rotation modes (with TTL table), Example curl
  (copyable, parametrized by `proxyUsername`). Pure presentational —
  no backend calls. Compose with `<PoolSessionSpawner>` and
  `<ActiveSessionsTable>` for full reseller dashboard parity with
  `client.proxies.sx/pool-proxy`.
- **`<PoolStockGrid>`** — live per-country online endpoint counts for
  both `mbl` mobile and `peer` residential pools. Two layouts: `grid`
  (responsive cards with health pills) and `compact` (one line per
  country). Auto-polls `/api/pool/stock` every 30 s.
- New CSS classes: `psx-docs-*`, `psx-stockgrid-*`. Existing brand
  variables (`--psx-primary`, `--psx-radius`, etc.) flow through.

### Backwards compatibility

Additive only. SDK peer dep stays at `^0.4.0`.

---

## 0.4.0 — Multi-port spawner + active-sessions table

Coronium-driven UX parity with `client.proxies.sx/pool-proxy`.
Resellers shipping `<PoolPortal>` can now drop in two new components
and ship the same multi-port-generation + live-session-management
experience without writing it from scratch (~600 LOC saved per
integration).

### Added

- **`<PoolSessionSpawner>`** — count slider (1–100), country / pool /
  protocol / rotation / sid-mode controls, "Generate" → N proxy URLs,
  per-row Copy + bulk Copy-all + Download .txt actions.
- **`<ActiveSessionsTable>`** — live polling of the user's sessions
  with country, sid, IP, rotation, TTL countdown, byte counts, request
  count, per-row Copy URL + Close, header Close-all action. Hides
  synthesized-sid sessions by default.
- **`buildProxyString(opts)`** — exported helper used by the spawner;
  also useful from your own code.
- **Server-side handlers** — `createPoolApiHandlers()` now exposes:
  - `GET <route>/my-sessions` — list current user's sessions
  - `DELETE <route>/my-sessions/<key>` — close one (ownership-checked)
  - `DELETE <route>/my-sessions` — close all
- **Audit events** — `session.closed`, `sessions.closed_all` callbacks
  on `onAudit`.

### Changed

- **Bumped `@proxies-sx/pool-sdk` peer to `^0.4.0`** — gives consumers
  the new `client.sessions` namespace and the `ActiveSession` type
  (which includes `proxyUrl`/`socks5Url` template fields the new
  components consume).

### Backwards compatibility

Additive only. `<PoolPortal>` unchanged. Existing hooks unchanged.
Existing `createPoolApiHandlers` GET/POST routes unchanged.

---

## 0.3.0 — Pool stock fix + SDK 0.3.1 alignment

Surfaced by Coronium's live integration audit (2026‑05‑01). The
`<StockIndicator>` inside `<PoolPortal>` was reading the old
`stock.countries.find(...)` shape that never matched the live API —
which meant **every dashboard built on this component was rendering a
blank stock indicator**.

### Fixed

- **`StockIndicator` reads the correct `stock.pools.{mbl,peer}[country]`**
  shape from `GET /v1/gateway/pool/stock`. Pre-0.3.0 it iterated
  `stock.countries` which was always `undefined`. Live numbers now
  render in dashboards.

### Changed

- **Bumped `@proxies-sx/pool-sdk` peer to `^0.3.1`** — gives consumers
  built-in retry, idempotency-key support, `topUp()`, `get()`, and
  `requestId` correlation. See the SDK CHANGELOG for the full list.
- **README example:** Stripe webhook handler now uses `poolKeys.topUp()`
  for top-ups (atomic, race-safe, idempotent) instead of the
  read-modify-write pattern over `update()`. The mint path also
  shows passing `idempotencyKey: ` `mint_${session.id}` ` for
  retry-safety.

### Migration

If you've been using `<PoolPortal showStock />` and the count was
silently rendering blank, install 0.3.0 — it just starts working.
No code changes on your end.

---

## 0.2.0

- Initial release with `expiresAt` / countdown banner support.
