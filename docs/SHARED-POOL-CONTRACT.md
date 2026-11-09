# Shared-pool integration contract

Verified provider release, 4 November 2026. Public gateway access reopened at
11:21 UTC after draining the old workers. All seven API workers, the cron worker
and four gateway workers were checked against the release artifacts.

| Component | Verified state |
| --- | --- |
| Session ownership/inventory containment | Backend r85 `0deccb6d-20261104-r85-session-containment`, live 09:42:28 UTC on seven API workers |
| PAK binding isolation, exact observation and conditional release | Gateway `cf0b62ce-20261104-r86`; backend `301cef19-20261104-r86-shared-pool`, live |
| Durable lifecycle operations and versioned holds | Backend `301cef19-20261104-r86-shared-pool`, live |
| Durable accounting projections | r86 live; eight producers observed settling real traffic. Historical anonymous accounting remains outside this guarantee |
| SDK and React package containing these client changes | Version `0.15.0`; verify the installed version before using the added methods |

These HTTP contracts do not require adopting this SDK. A custom HTTP adapter is
supported. Keep reseller credentials on the server and resolve the authenticated
customer's PAK record id from your own ownership mapping on every request.

## Connection configuration

Choose `pool` explicitly in builders and stock discovery. The SDK URL builder's
omitted-pool default is `mbl`. `peer` contains more than one reported IP class;
use the supported `iptype-residential` filter when residential-only selection is
required. Do not silently widen unavailable or unsupported targeting.

Persist the original pool, country, targeting, protocol, rotation mode, TTL and
an opaque SID for each named configuration. Use a unique SID per customer and
logical configuration, including with provider-side PAK isolation. A
logical change gets a new SID; a display-name change need not. Session-list URL
templates are not authoritative copies of the customer's original settings.

`auto5`, `auto10`, `auto20` and `auto60` are minutes. They require the same SID
across connections. Selection is evaluated on a subsequent connection; the timer
does not terminate existing sockets or guarantee a different public IP. Sticky
is a binding preference, not a device reservation or immutable public IP.

## Usage and eligibility

`trafficUsedMB` is raw bytes divided by 1024², including upload and download.
GB is MB divided by 1024. `trafficCapGB` is a cumulative lifetime cap. Top-up
increases the cap; it does not reset raw usage or automatically resume a key.
`trafficUsedGB` is rounded and must not determine exact eligibility. Raw customer
traffic is distinct from weighted reseller charges.

Validate raw counters, cap, enabled and expiry. Missing, malformed or stale
evidence remains unknown; it must not replenish a displayed allowance. Preserve
last valid readings and their observation times. Enabled alone does not prove
usable quota, account funding, available stock or valid expiry.

Daily history is per PAK and uses UTC processing-day buckets. The request range
can exceed storage retention. A zero-filled row without coverage evidence does
not establish measured zero. Local cumulative snapshots do not establish exactly
which day a gap's consumption occurred. Per-session counters are not an
authoritative historical billing source.

## Mutations and recovery

Persist operation identity and immutable intent before create, top-up, update,
regeneration or deletion. Serialize writes for the same logical customer/key
across workers. Keep payment settlement, entitlement grant, provider effect and
customer delivery separately verifiable.

This SDK makes one attempt for shared-pool key and binding mutations, even when
an `Idempotency-Key` is supplied. A timeout, 429, 5xx or failed response read does
not authorize another dispatch. Inspect the original operation under the exact
released provider contract; keep uncertainty across process restart. Older cached
replay contracts do not establish concurrent or crash-safe execution.

After ambiguous password regeneration, recover the **current** scoped key with
`GET /v1/reseller/pool-keys/:id`, or an authorized reveal operation. Do not
regenerate again because storing the response failed. A historical operation
result is distinct from a current secret observation; another authorized writer
may change the credential later. There is no guaranteed fixed cache propagation
or socket termination deadline.

The React regeneration handler forwards the caller's operation key. A failing
`onAudit` callback after acknowledged provider success produces `auditStatus:
'failed'` with the successful result. It does not fabricate an upstream failure.
The host must repair its audit persistence without repeating the provider write.

### Durable lifecycle operations

These routes are deployed for shared-pool keys in backend r86.
Private-pool and provider-managed x402 key flows retain their separate product
contracts; do not use these routes to bypass their ownership or payment rules.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/v1/reseller/pool-keys` | Create with durable operation intent |
| `POST` | `/v1/reseller/pool-keys/:id/topup` | Increase cumulative cap and/or expiry; preserve holds |
| `PATCH` | `/v1/reseller/pool-keys/:id` | Change supported fields or disable; `enabled:true` requires reviewed resume |
| `POST` | `/v1/reseller/pool-keys/:id/regenerate` | Change secret, retaining stable PAK record identity |
| `DELETE` | `/v1/reseller/pool-keys/:id` | Remove the key through the same lifecycle boundary |
| `GET` | `/v1/reseller/pool-keys/operations/lookup` | Read evidence using the original `Idempotency-Key` header |
| `GET` | `/v1/reseller/pool-keys/operations/:operationId` | Read secret-free operation evidence by ID |
| `POST` | `/v1/reseller/pool-keys/:id/resume` | Conditionally release a sole cap hold |

For mutations, persist `Idempotency-Key` (8–128 characters from `[A-Za-z0-9_-]`)
and immutable intent before dispatch. The token is unique across actions and
targets within the reseller account. Reuse with changed intent returns
`409 IDEMPOTENCY_CONFLICT`. Without a caller token, a completely lost response
cannot be recovered by token lookup.

The r86 journal has no TTL and stores no historical password. It records
`accepted`, `submitted`, `applied`, `uncertain` or `rejected` state, action, target,
fingerprint, versions and timestamps. Admission, the key effect with its applied
receipt, and finalization use journaled majority-acknowledged writes. A retained
operation is reconciled rather than dispatched again. An unresolved claim stays
blocked through restart; elapsed time does not authorize a second effect. The
scheduled recovery job finalizes proven outcomes and alerts on unresolved ones.
It does not guess success from a missing receipt.

SDK: `poolKeys.operationByToken(savedToken)` or
`poolKeys.operation(savedOperationId)`. Read-only results include `keyWriteState`
(`ready`, `reconciliation_pending`, `held` or `unknown`) at `observedAt`. This is
an observation, not a lock granted to the caller. Mutation responses include
`operation.id`, historical `appliedVersion`, `credentialObservation: 'current'`,
`observedAt` and `replayed`; key `credentialVersion` describes the current
observation. A later writer can change that credential.

The November 4 pre-r86 implementation used nominal 24-hour sequential
cached replay with concurrency and crash gaps. Those older requests do not gain
the r86 guarantees retroactively. Token lookup `404` cannot prove an old
request had no effect. A retained legacy cache without durable evidence reports
`LEGACY_IDEMPOTENCY_RECORD`; migrated barriers report `LEGACY_REPLAY_BLOCKED`.
Keep uncertain old operations gated for review. Never use a new token just to
escape an unresolved outcome.

### Conditional resume

`POST /v1/reseller/pool-keys/:id/resume` takes only
`{ expectedLifecycleVersion }` in the body and the persisted operation token in
`Idempotency-Key`. SDK:
`poolKeys.resume(id, { expectedLifecycleVersion, idempotencyKey })`.

Before an authorized call, reconcile the intended grant, raw usage/cap, expiry,
account eligibility and every local/provider hold. The r86 resume operation atomically
checks the same key's version, remaining quota, expiry, disabled state and sole
`cap` hold. It rejects a different or additional hold. Account eligibility is
read from a separate record; this is not a transaction against a later account
ban. Gateway account/funding checks still apply.

Routine sync and payment callbacks must not send `enabled:true`. Shared-key PATCH
returns `RESUME_REVIEW_REQUIRED`. Missing legacy suspension reasons remain
`legacy`, not an inferred cap hold. Admin review can address a specific hold;
clearing one must preserve every other hold. Top-up never clears a hold.

### Raw observations and history

Backend r86 returns `trafficUsedMB: null`, `usageState: 'unknown'` for absent or
malformed usage, and `expiryState: 'unknown'` for invalid expiry. Preserve the
last valid observation; do not convert these to zero or no expiry.

Daily history adds `coverage: { basis: 'stored_daily_rollups', retentionDays: 90,
requestedDays, complete: false, approximateRetentionStart }` and per-day
`observed`, `observedAt` and unrounded `rawMB`. Compatibility numeric columns may
still be zero-filled. `observed:false` means unknown; an observed row is still
not proof of complete coverage for that day. Requesting 365 days does not extend
retention or establish per-session accounting.

## Session inventory and release

`GET /v1/gateway/pool/my-sessions?pakId=:ownedRecordId` is a bounded observation.
Retain `truncated`, errors and freshness. It is not a complete inventory or a
live-socket count. Backend r85 reports read failures rather than false-empty
success, but even a valid empty read cannot prove that an old URL cannot rebind.

SDK: `sessions.list({ pakId })`. Never expose an unscoped reseller-wide list or
delete through a customer-facing route.

The deployed binding-v2 contract adds an exact scoped read at
`GET /v1/gateway/pool/my-sessions/:encodedKey?pakId=:ownedRecordId`. Its response
identifies `contractVersion: 2`, `observedAt`, `success:true` and an allowlisted
`binding` containing `sessionKey`, `accountId`, `pakKeyId`, `sessionId`,
`bindingGeneration`, `createdAt` and `expiresAt`. It contains no exit IP or secret.
This is an observation, not URL revocation. Use only after the deployment table
above confirms its release.

Conditional release uses the same path with `DELETE`, the stored `pakId` and
`generation`. It removes only the matching owned assignment. A changed generation
returns HTTP 409; missing binding is distinct from success and read failure is
HTTP 503. Without a caller generation, the backend observes once and performs
one conditional delete; a timed-out caller still must not blindly repeat it.
SDK: `sessions.get(key, { pakId })` and `sessions.close(key, { pakId, generation })`.

The deployed binding namespace uses stable PAK **record identity**, separate
from password/credential version. Regenerating a password preserves that
namespace. Account-password bindings use a separate namespace. Existing URL
strings and SID values remain valid; old bindings are adopted only when their
stored account and PAK ownership match. A different PAK cannot adopt a colliding
legacy row. Deploying mixed old/new gateway writers would undermine isolation;
the provider rollout must drain old writers before migration.

A generation identifies an assignment/configuration version. Endpoint failover,
logical binding settings or timer replacement change it; passive activity and
password rotation do not. A stale release cannot delete a replacement version.
Held sockets keep their original assignment and do not become new bindings.

Always check `success`, including HTTP 200 responses. Bulk release can be partial;
`count` means acknowledged deletions, not proof of absence. The React table
disables bulk release for truncated inventory and retains unknown outcomes in
the mounted component. Hosts must persist operation state across reloads; this
component is not a durable mutation journal.

Binding release leaves existing sockets open. Exported credentials can establish
another binding. Neither local configuration deletion nor a successful release
revokes a password or guarantees a different IP.

## Diagnostics, stock and limits

Use `GET /v1/gateway/incidents` for incident notices. Check a diagnostic's `ok`
field as well as HTTP status. One successful probe is not proof of sustained
performance, destination acceptance or concurrency capacity.

Query live facets with explicit country and pool. Individual nonzero facets do
not prove their combined intersection has stock. Distinguish known zero from
unknown or stale data. Do not infer supported filters from a formatter accepting
a token. Unsupported combinations must be refused or explicitly withheld.

A generic CONNECT 407 or SOCKS authentication failure cannot uniquely identify
the cause. Use verified structured evidence where available; retain unknown
otherwise. Provider funding failures must not tell a customer to buy more GB.

Connection/session limits are account-level configuration observations, not RPS
guarantees or reserved stock. Do not promise per-key fairness without a released
enforcement contract. Continue verified polling unless PAK webhook delivery,
signature, ordering and replay contracts are explicitly released.

## Starter payment delivery

The optional `apps/starter` keeps a delivery journal on its `purchases` row. It
stores the provider `Idempotency-Key` before dispatch, marks the purchase
delivered only after the provider confirmed, and answers Stripe non-2xx until
then. A retry reads the retained operation by the same key and dispatches only
after a lookup `404`. A `rejected` operation proves no effect and permanently
consumes its key, so it is the one case where the starter sends a new key for
the same payment (`topup_<session id>_2`). `accepted`, `submitted` and
`uncertain` are never dispatched again. After an applied top-up the starter
calls the conditional resume only for a sole `cap` hold.

Recovery runs on Stripe retries only; there is no restart-safe worker, no refund
or dispute handling, and purchases recorded before the journal are treated as
delivered. The flow is tested with fakes and a real PostgreSQL, not against the
live provider. Remaining work is tracked in
[issue #4](https://github.com/bolivian-peru/proxy-reseller-kit/issues/4).
Portproof's custom integration does not use this starter; its local
implementation and production deployment must be evaluated separately.

## Joint rollout

Keep old working credentials and exported URLs while introducing persistent
named configurations. Validate two PAKs under the same reseller account, deliberate
SID collisions, response loss, concurrent writes and rebinding after timeout.
Use isolated fixtures or authorized QA accounts, not an exhausted real customer.
Record exact provider releases separately from local application tests and the
reseller's production release. A passing local integration suite does not deploy
either side.
