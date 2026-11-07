# Webhooks — the two delivery contracts and how to verify each

> Rewritten 2026‑11‑07 for SDK 0.10.0 against the backend source (files cited
> at the end). The 2026‑05 version of this file was a design proposal for
> `pak.*` events; this one documents what the platform sends today. The SDK
> does not manage subscriptions, it only verifies deliveries.

The platform has **two** webhook systems, and they sign differently. Which one
your endpoint is registered with decides which header you verify and which SDK
function you call:

| You registered through | Signature header you receive | Verify with |
|---|---|---|
| `POST /v1/reseller/webhooks` (the self-serve reseller API, `webhooks:write` scope) | `X-Webhook-Signature: sha256=<hex>` **only** | `verifyLegacyWebhookSignature()` |
| A platform event subscription created for you by Proxies.sx (the events service; `/v1/events/subscriptions` is restricted to platform administrators today) | `X-Proxies-Signature: t=<unix>,v1=<hex>` plus the legacy header | `verifyWebhookSignature()` |

If you created the endpoint yourself, you are on the first row. A receiver
that checks `X-Proxies-Signature` there sees no such header and rejects every
real delivery.

---

## TL;DR for a receiver

Self-serve reseller webhook (`/v1/reseller/webhooks`):

```ts
import express from 'express';
import { verifyLegacyWebhookSignature } from '@proxies-sx/pool-sdk';

app.post('/webhooks/proxies', express.raw({ type: '*/*' }), async (req, res) => {
  const ok = await verifyLegacyWebhookSignature(
    req.body as Buffer,                       // the EXACT bytes received
    req.header('x-webhook-signature'),        // "sha256=<hex>"
    process.env.PROXIES_WEBHOOK_SECRET!,      // the `secret` you set when registering
  );
  if (!ok) return res.status(400).send('invalid signature');

  const event = JSON.parse(req.body.toString('utf8'));
  if (await alreadyHandled(event.id)) return res.status(204).end(); // deliveries are retried
  await handle(event.type, event.data);
  res.status(204).end();
});
```

Event subscription created for you by Proxies.sx (events service):

```ts
import { verifyWebhookSignature } from '@proxies-sx/pool-sdk';

const ok = await verifyWebhookSignature(
  req.body as Buffer,
  req.header('x-proxies-signature'),          // "t=1762500000,v1=<hex>"
  process.env.PROXIES_WEBHOOK_SECRET!,      // the secret returned once at creation
);
```

Three rules, in order of how often they are broken:

1. **Verify over the raw body.** `JSON.stringify(req.body)` re-serialises and
   will not match. Use `express.raw()`, `await req.text()` in Next.js/Workers,
   or the equivalent in your framework.
2. **Dedupe on `event.id`.** A delivery that did not get a 2xx is retried;
   the same `id` arrives again.
3. **Answer fast.** The sender waits 30 s (reseller webhooks) or 10 s (events
   service) for a 2xx; do the work after you have acknowledged.

`data` is a notification, not a source of truth: it carries identifiers and
states. Read anything you bill or display (balances, usage, credentials)
back from the API.

---

## Self-serve reseller webhooks — `/v1/reseller/webhooks`

Routes (`X-API-Key` or JWT; scopes `webhooks:read` / `webhooks:write`;
reseller accounts only):

| Route | Purpose |
|---|---|
| `POST /v1/reseller/webhooks` `{ url, events, secret?, name?, headers? }` | Register. **You choose the `secret`**; without one deliveries are unsigned. `url` must be a public `https` host. |
| `GET /v1/reseller/webhooks`, `GET …/:id` | List / read. |
| `PUT /v1/reseller/webhooks/:id` `{ url?, events?, secret?, name?, isActive?, headers? }` | Update. `isActive: true` also resets the failure counter. |
| `DELETE /v1/reseller/webhooks/:id` | Remove. |
| `GET /v1/reseller/webhooks/event-types` | The event types the backend actually emits (live list; the picker only offers these). |
| `POST /v1/reseller/webhooks/:id/test` `{ eventType? }` | Sends a signed **test** payload of that type (`port.created` by default) with the header `X-Webhook-Test: true` and `test: true` in the body. There is no `ping` event on this system. |
| `GET /v1/reseller/webhooks/:id/deliveries?status=&eventType=&limit=` | Delivery history: status, attempts, response code, body excerpt. |

Envelope of a real delivery:

```json
{
  "id": "evt_9f2c…",                       // unique per event — dedupe on it
  "type": "port.created",                  // also in X-Webhook-Event
  "created": "2026-11-07T10:00:00.000Z",   // note: `created`, not `createdAt`
  "data": { … }
}
```

Headers:

| Header | Value |
|---|---|
| `X-Webhook-Signature` | `sha256=<hex>`, `hex = HMAC-SHA256(secret, rawBody)`. Only when the webhook has a `secret`. **The only signature this system sends.** |
| `X-Webhook-Event` | event type |
| `X-Webhook-Delivery` | delivery id (not on test deliveries) |
| `X-Webhook-Timestamp` | ISO time the attempt was made (not on test deliveries). It is **not** bound into the signature, so it is informational only. |
| `User-Agent` | `Proxies.sx-Webhook/1.0` |
| your `headers` | any custom headers configured on the webhook (`Host` is dropped) |

Delivery: a 2xx within **30 s** is a success. Anything else (timeout, 3xx —
redirects are never followed —, 4xx, 5xx) is retried after 1 m, 5 m, 15 m,
1 h and 2 h (5 attempts in all) with the same `id` and body. After **10
consecutive failures** the webhook is switched off by an hourly sweep
(`isActive: false`, `lastError: "Auto-disabled due to consecutive
failures"`); `PUT …/:id { "isActive": true }` turns it back on.

Event types emitted at the time of writing (read the live list):
`port.created`, `port.deleted`, `port.rotated`, `port.suspended`,
`port.unsuspended`, `customer.created`, `customer.updated`,
`customer.suspended`, `customer.unsuspended`, `customer.tier_upgraded`,
`customer.quota_warning`, `customer.quota_exceeded`, `balance.topup`.

Secret rotation: `PUT …/:id { "secret": "<new>" }` takes effect on the next
delivery; there is no overlap window. Update the receiver first (accept both
secrets for a few minutes), then rotate.

---

## Platform event subscriptions — the events service

This is the system that signs with a timestamp. Its management routes
(`/v1/events/subscriptions`, `…/:id/regenerate-secret`, `/v1/events/types`,
`/v1/events/deliveries`) require the platform **admin** role, so a reseller
cannot create one of these subscriptions through the API today. You are on
this system only if Proxies.sx created a subscription for your endpoint and
handed you its secret (it is returned once, at creation).

Headers on every delivery:

| Header | Value | Use |
|---|---|---|
| `X-Proxies-Signature` | `t=<unix seconds>,v1=<hex>` | **Verify this one.** `v1 = HMAC-SHA256(secret, "<t>.<rawBody>")`. |
| `X-Proxies-Event` | event type | routing without parsing the body |
| `X-Proxies-Delivery` | delivery id (= body `id`) | dedupe |
| `X-Webhook-Signature` | bare `<hex>` = `HMAC-SHA256(secret, rawBody)` | legacy, no timestamp; note **no** `sha256=` prefix here |
| `X-Event-Type`, `X-Delivery-Id` | duplicates of event type and delivery id | sent to every subscription; older names |

Envelope:

```json
{
  "id": "672c0f1e9a1b2c3d4e5f6a7b",         // opaque delivery id (a `ping` uses "ping_<ms>")
  "type": "deposit.received",
  "createdAt": "2026-11-07T10:00:00.000Z",
  "data": { … }
}
```

Delivery: a 2xx within **10 s** is a success; otherwise retried after 1 m,
5 m, 30 m, 2 h and 12 h (5 attempts) with the same `id`. Twenty exhausted
deliveries in a row deactivate the subscription.

The header carries **one** `v1` today. `verifyWebhookSignature()` accepts
several so a future overlapping-secret rotation needs no client change.
`POST /v1/events/subscriptions/:id/regenerate-secret` replaces the secret
immediately and takes effect on the next delivery, so update the receiver
first, then regenerate, and expect deliveries sent in between to fail
verification (they are retried on the schedule above).

---

## What the two SDK functions do

```ts
verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,   // X-Proxies-Signature
  secret: string,
  opts?: { toleranceSec?: number; nowMs?: number; crypto?: Crypto },
): Promise<boolean>

verifyLegacyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,   // X-Webhook-Signature, "sha256=<hex>" or bare hex
  secret: string,
  opts?: { crypto?: Crypto },
): Promise<boolean>
```

`verifyWebhookSignature`:

1. Parses `t=` and every `v1=` from the header. Missing or malformed → `false`.
2. Rejects when `|now − t| > toleranceSec` (default **300 s**). Replays of a
   captured delivery fail here even though their HMAC is valid.
3. Computes `HMAC-SHA256(secret, "<t>.<rawBody>")` and checks it against each
   `v1` with Web Crypto `subtle.verify`, which compares in constant time.
4. Resolves `true` only when a candidate matches.

`verifyLegacyWebhookSignature` strips an optional `sha256=` prefix and checks
`HMAC-SHA256(secret, rawBody)` the same way. It has no timestamp, so it cannot
detect a replayed delivery: keep the receiver idempotent on `event.id` and
reject ids you have already handled.

Neither throws on bad input; the single exception is a `ProxiesConfigError`
when the runtime has no Web Crypto (`globalThis.crypto.subtle`): Node ≥ 19,
Bun, Deno, Workers and Edge have it; on Node 18 pass `{ crypto: webcrypto }`
from `node:crypto`.

Verifying by hand (any language):

```python
import hmac, hashlib, time

# self-serve reseller webhook: X-Webhook-Signature: sha256=<hex>
expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, header.removeprefix("sha256="))

# events service: X-Proxies-Signature: t=<unix>,v1=<hex>
parts = dict(p.split("=", 1) for p in header.split(","))
expected = hmac.new(secret.encode(), f"{parts[\"t\"]}.".encode() + raw_body, hashlib.sha256).hexdigest()
ok = abs(time.time() - int(parts["t"])) <= 300 and hmac.compare_digest(expected, parts["v1"])
```

---

## Not shipped

The `pak.*` events proposed in the 2026‑05 version of this document
(`pak.usage.threshold_crossed`, `pak.expired`, `pak.disabled`) are **not**
emitted by either system; poll `poolKeys.list()` / `poolKeys.get()` for key
usage and expiry until they appear in `GET /v1/reseller/webhooks/event-types`.

---

## Source of truth

This page was written from the backend as deployed in November 2026. When it
and the code disagree, the code wins; these are the files to read:

- `src/reseller/reseller-webhook.controller.ts` — the `/v1/reseller/webhooks` routes and scopes.
- `src/reseller/services/reseller-webhook.service.ts` — envelope, headers, `sha256=` signature, 30 s timeout, retry schedule, test payload.
- `src/reseller/schemas/reseller-webhook.schema.ts` — `EMITTED_WEBHOOK_EVENTS`, the live event list.
- `src/events/webhook-delivery.service.ts` — the `t=,v1=` signer, `X-Proxies-*` headers, 10 s timeout, retry schedule.
- `src/events/events.controller.ts` — `/v1/events/*` routes and their admin-only guard.
