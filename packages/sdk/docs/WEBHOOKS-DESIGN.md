# Block 2 Design — Pool Access Key Webhooks (`pak.*` events)

> Plan to migrate resellers from 30-min `list()`
> polling to push notifications. Authored 2026‑05‑01. Targets SDK 0.4.0.

---

## TL;DR

Extend the **existing** reseller webhook infrastructure
(`src/reseller/services/reseller-webhook.service.ts`,
`schemas/reseller-webhook.schema.ts`,
`schemas/webhook-delivery.schema.ts`) with five new event types:

- `pak.usage.threshold_crossed` — emitted at 50%, 80%, 100% cap
- `pak.expired` — when `expiresAt` passes (real-time, not cron-bound)
- `pak.disabled` — operator forced disable, abuse, etc.
- `pool.incident.opened` — gateway-wide degradation notice
- `pool.incident.resolved` — clears the prior incident

Reuse the existing HMAC-SHA256 signing, retry queue, delivery-tracking
collection, and admin UI for managing endpoints. No parallel system.

The SDK gets one new helper (`verifyWebhookSignature`) and a `WebhookEvent<T>`
type union. No client method changes — webhook config lives in the
client.proxies.sx admin, not in the SDK.

---

## Why extend the existing infra (vs build new)

We already have:
- `ResellerWebhook` schema with `url`, `events[]`, `secret`, `failureCount`,
  `isActive`, soft-delete.
- `WebhookDelivery` collection tracking `success`, `responseStatus`,
  `attemptedAt`, `nextRetryAt` per event.
- `ResellerWebhookService` — registration, signing, delivery, retry loop.
- 17 existing event types working in production.
- Admin UI under `/v1/reseller/webhooks` for resellers to register/test.

Building a parallel `pak.*` system would mean: duplicate retry logic,
duplicate signing, duplicate admin UX, two places resellers configure
endpoints, two collections to keep tidy. Multiplies bug surface for
zero customer benefit.

The 5 new event types slot directly into the existing `events[]` array
on `ResellerWebhook`, so a reseller subscribes to `pak.expired` exactly
the way they already subscribe to `port.expired`.

---

## Event payloads

All events share the existing envelope (matches the existing `port.*`
shape, so the on-the-wire format is consistent across event families):

```ts
interface WebhookEvent<T = unknown> {
  id: string;            // unique delivery id (idempotency on receiver side)
  type: string;          // 'pak.expired', etc.
  created: string;       // ISO 8601 UTC
  resellerId: string;    // for multi-tenant receivers
  data: T;               // event-specific payload below
}
```

### `pak.usage.threshold_crossed`

Fired exactly once per (key, threshold) pair. The traffic flush pipeline
already records `trafficUsedMB` increments — we add a small Redis
"high-watermark" entry per key (`gw:pak:hw:<keyId>` storing the highest
threshold already fired) and emit when the new value crosses the next
threshold.

```ts
interface PakUsageThresholdData {
  poolKeyId: string;
  label: string;
  threshold: 50 | 80 | 100;     // percent of cap
  trafficUsedGB: number;
  trafficCapGB: number | null;  // null = unbounded; threshold events skipped
  lastUsedAt: string;
}
```

### `pak.expired`

Fired the moment `expiresAt` passes. Not cron-bound — emitted
synchronously when the inline expiry check in `findByKey` first detects
a now-expired key. (Today's nightly cron flips `enabled=false` for
tidiness; the webhook fires from the gateway-auth path so it's
real-time.)

```ts
interface PakExpiredData {
  poolKeyId: string;
  label: string;
  expiresAt: string;        // the moment that just passed
  trafficUsedGB: number;
  trafficCapGB: number | null;
}
```

### `pak.disabled`

Fired when `enabled` flips from `true` to `false` for any reason —
operator action, the expiry cron, an abuse handler. The `reason` field
indicates why.

```ts
interface PakDisabledData {
  poolKeyId: string;
  label: string;
  reason: 'operator' | 'expiry' | 'abuse' | 'cap_reached' | 'reseller_action';
  disabledAt: string;
}
```

### `pool.incident.opened` / `pool.incident.resolved`

Mirrors the existing `/gateway/incidents` feed. Useful for status pages
and customer comms. Only fires for incidents with `severity >= minor`.

```ts
interface PoolIncidentData {
  incidentId: string;
  severity: 'minor' | 'major' | 'critical';
  title: string;
  description?: string;
  affects: string[];        // e.g. ['country:de', 'pool:peer']
  startedAt: string;
  resolvedAt?: string;      // present only on .resolved
}
```

---

## Wire format — signing

Identical to existing `port.*` webhooks. Header:

```
X-Proxies-Signature: t=<unix_ts>,v1=<sha256_hex>
X-Proxies-Event: pak.expired
X-Proxies-Delivery: <delivery_id>
```

`v1` is `HMAC-SHA256(secret, "<unix_ts>.<raw_body>")`. Receivers MUST:

1. Reject if `t` is more than 5 minutes off from server clock (replay).
2. Recompute the HMAC and compare with `crypto.timingSafeEqual`.
3. Dedupe on `delivery_id` (an event might be retried after a 502 from
   the receiver — they should treat it as already-handled).

The SDK ships `verifyWebhookSignature(rawBody, header, secret)` that
returns `boolean`. It does the timestamp window check, the constant-time
compare, and returns `false` (not throw) on any mismatch.

---

## Delivery semantics

Reuses the existing retry policy on `ResellerWebhookService`:

| Attempt | Delay |
|---|---|
| 1 | immediate |
| 2 | 15 s |
| 3 | 1 min |
| 4 | 5 min |
| 5 | 30 min |
| 6 | 2 h |
| 7 | 12 h |
| 8 | 24 h then dead-letter |

A 2xx response within 10 s = success. Anything else (timeout, 4xx, 5xx)
queues a retry. After 8 failed attempts we mark the delivery dead-lettered
and surface it in the admin UI; the receiver-side reseller can replay
manually.

`failureCount` on `ResellerWebhook` increments on every dead-letter; if
it crosses 50 within 24h we auto-disable the endpoint and email the
reseller.

---

## SDK surface (0.4.0)

### New types

```ts
// Re-exported from @proxies-sx/pool-sdk
export type WebhookEventType =
  | 'pak.usage.threshold_crossed'
  | 'pak.expired'
  | 'pak.disabled'
  | 'pool.incident.opened'
  | 'pool.incident.resolved';

export interface WebhookEvent<T = unknown> {
  id: string;
  type: WebhookEventType;
  created: string;
  resellerId: string;
  data: T;
}

export interface PakUsageThresholdData { /* see above */ }
export interface PakExpiredData       { /* see above */ }
export interface PakDisabledData      { /* see above */ }
export interface PoolIncidentData     { /* see above */ }
```

### New helper

```ts
/**
 * Verify a webhook delivery signature. Returns true iff the signature
 * matches and the timestamp is within `toleranceSec` (default 300) of
 * server-now. Use this in your webhook receiver before parsing the body.
 *
 * @example
 * ```ts
 * app.post('/webhooks/proxies', express.raw(), (req, res) => {
 *   const ok = verifyWebhookSignature(
 *     req.body.toString('utf8'),
 *     req.header('x-proxies-signature') ?? '',
 *     process.env.PROXIES_WEBHOOK_SECRET!,
 *   );
 *   if (!ok) return res.status(400).send('invalid signature');
 *   const event = JSON.parse(req.body.toString('utf8')) as WebhookEvent;
 *   // ... handle by event.type
 *   res.status(204).end();
 * });
 * ```
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSec?: number,
): boolean;
```

### No new client methods

Webhook config (URL, secret, event subscriptions) lives in the
client.proxies.sx admin UI. We considered adding `client.webhooks.*`
methods but resellers configure endpoints once at integration time —
not from app code. Keeping it dashboard-only avoids tempting people
to manage webhook config from app code (which is brittle and racy).

---

## Server-side implementation tasks

| File | Change |
|---|---|
| `src/reseller/schemas/reseller-webhook.schema.ts` | Add `pak.*` and `pool.incident.*` to `WebhookEventType` enum. |
| `src/reseller/services/reseller-pool-access-key.service.ts` | Emit `pak.disabled` from `update()` and `delete()` when `enabled` flips false. Emit `pak.expired` from `findByKey()` inline-expiry path. |
| `src/traffic/fetch-server-stats.service.ts` (or new `pak-usage-watcher.service.ts`) | After each traffic flush, check Redis high-watermark per pak; emit `pak.usage.threshold_crossed` for each crossed threshold. |
| `src/gateway/gateway.service.ts` | When the gateway opens an incident notice, emit `pool.incident.opened` to all resellers subscribed. |
| `src/reseller/services/reseller-webhook.service.ts` | No change — already handles arbitrary event types. |

Estimated effort: 3-4 days incl. tests.

---

## Migration path for a reseller

1. **Today** — the reseller polls `list()` every 30 min. Works.
2. **0.4.0 ships** — the reseller adds a webhook endpoint on their API,
   configures it in
   the proxies.sx admin with a fresh signing secret.
3. They use `verifyWebhookSignature()` in their handler, dispatches
   to internal handlers by `event.type`.
4. Polling cadence drops from 30 min → 6 h (still useful as a
   reconciliation safety net for the 0.x% of webhooks that get lost).
5. Customer-facing dashboards become real-time (low-balance banners
   appear within seconds of crossing 80%, not 30 min later).

---

## Open questions to resolve before implementation

- **Threshold for `pool.incident.*`** — do we emit on `severity: minor`
  or only `major` and above? reseller feedback wanted minor included for
  status pages. Default: emit minor + above. (Resellers can filter
  client-side.)
- **`pak.disabled` for `reason: 'expiry'` AND `pak.expired`** — both fire
  for the same underlying transition. Choice: emit both. They carry
  different signal (`pak.expired` is the moment-of-expiry, `pak.disabled`
  is the cleanup write). Receivers should subscribe to whichever they
  want, not both, to avoid double-handling.
- **Per-key opt-out** — should resellers be able to disable webhooks for
  specific high-traffic keys (e.g. an ad-verification key flushing every
  5 min)? Defer to a future minor — overengineering for v1.

---

*Status: design — not yet implemented. The platform's `/v1/reseller/webhooks`*
*still emits port and sub-account events only (verified 2026-11-03).*
