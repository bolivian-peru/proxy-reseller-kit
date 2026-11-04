# Migration guide: `@proxies-sx/pool-sdk` 0.2.0 → 0.3.0

> **Shared-pool contract update — 4 November 2026:** the [current release table and recovery contract](SHARED-POOL-CONTRACT.md) supersede older shared-key retry, automatic resume and session-release guidance here. Candidate APIs require verified provider deployment; package installation alone does not activate them. Persist intent, make one mutation attempt, recover by read-only operation lookup, and never resume from routine sync. Private-pool and provider-managed x402 payment flows remain separate.

**Choose the pool explicitly in every connection setup.** Do not rely on the SDK's `mbl` default; use the intended pool and matching stock scope. See [pool selection](./USERNAME-DSL.md#choose-the-pool-explicitly), including residential-only filtering and the `safe` PAK override.

This release is **non-breaking** — every 0.2.0 call still works without
modification. But you'll want to migrate four patterns to take advantage
of the new features and remove now-redundant host-app code.

---

## 1. Delete your retry wrapper

**Before** (your code):

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 250 * 2 ** i));
    }
  }
  throw lastErr;
}

const keys = await withRetry(() => proxies.poolKeys.list());
```

**After** (SDK does it):

```ts
const keys = await proxies.poolKeys.list();
```

For reads, the SDK retries bounded `5xx`, `429`, timeout and network failures,
honoring `Retry-After`. Current shared-key and binding mutations make one
attempt regardless of this setting; recover uncertain effects by reading the
original operation. To tune read retries:

```ts
new ProxiesClient({
  apiKey: '...',
  retry: { attempts: 5, baseDelayMs: 500, maxDelayMs: 8_000 },
});
```

To disable (e.g. you have your own retry/circuit breaker upstream):

```ts
new ProxiesClient({ apiKey: '...', retry: false });
```

**⚠️ Don't combine** — host retry + SDK retry → thundering herd on
transient gateway failures.

---

## 2. Pass `idempotencyKey` on every write

If you mint keys from a webhook handler or payment-success callback,
you've been one network blip away from a double-mint since day one.
0.3.0 introduced cached replay via `idempotencyKey`; it did not solve concurrent or crash-window ambiguity. Use the current release-gated durable operation contract for new work.

**Before:**

```ts
// Bug: a 504 from the platform after the DB write would cause a retry
// to mint a SECOND key, leaving you double-billed.
const key = await proxies.poolKeys.create({
  label: `customer:${customerId}`,
  trafficCapGB: 10,
});
```

**After:**

```ts
const key = await proxies.poolKeys.create({
  label: `customer:${customerId}`,
  trafficCapGB: 10,
  idempotencyKey: stripeSessionId,    // any unique-per-domain id
});
```

Tie `idempotencyKey` to a domain object — `stripe_payment_intent_id`,
`order_id`, `invoice_id`, your own UUIDv4 stored alongside the customer
record, before dispatch. The historical implementation cached sequential replies
for nominally 24 hours; it did not ensure concurrent/crash-safe execution. Current
shared-key SDK mutations make one attempt. Reconcile the original operation under
the verified released contract instead of relying on retries or cache expiry.

Apply the same to `topUp()` and `regenerate()`:

```ts
await proxies.poolKeys.topUp(keyId, {
  addTrafficGB: 10,
  extendDays: 30,
  idempotencyKey: `topup_${invoiceId}`,
});

await proxies.poolKeys.regenerate(keyId, {
  idempotencyKey: `rotate_${incidentId}`,
});
```

---

## 3. Replace top-up read-modify-write with `topUp()`

**Before** (the documented v0.2.0 pattern — vulnerable to a race when two
top-ups land on the same key concurrently):

```ts
async function topUpKey(keyId: string, addGB: number, extendDays: number) {
  const keys = await proxies.poolKeys.list();
  const current = keys.find((k) => k.id === keyId);
  if (!current) throw new Error('not found');
  await proxies.poolKeys.update(keyId, {
    trafficCapGB: (current.trafficCapGB ?? 0) + addGB,
    expiresAt: new Date(
      Math.max(Date.now(), new Date(current.expiresAt!).getTime()) +
        extendDays * 86_400_000,
    ).toISOString(),
  });
}
```

**After** (single atomic write, race-safe, no list scan):

```ts
async function topUpKey(keyId: string, addGB: number, extendDays: number, invoiceId: string) {
  await proxies.poolKeys.topUp(keyId, {
    addTrafficGB: addGB,
    extendDays,
    idempotencyKey: `topup_${invoiceId}`,
  });
}
```

`topUp()` does on the server:
- `$inc: { trafficCapGB: addTrafficGB }` if cap isn't `null`.
- `$set: { expiresAt: max(now, current_expiresAt) + extendDays }`.
- All inside one `findOneAndUpdate` — atomic relative to other top-ups.

---

## 4. Replace `list()` + filter with `get(keyId)`

If you know the id, don't download the whole fleet.

**Before:**

```ts
const keys = await proxies.poolKeys.list();
const k = keys.find((x) => x.id === keyId);
if (!k) throw new Error('not found');
```

**After:**

```ts
const k = await proxies.poolKeys.get(keyId);  // throws ProxiesApiError(404) if missing
```

Saves bandwidth, server CPU, and time.

---

## 5. Surface `requestId` in your logs and support flow

Every response (success or error) now carries `X-Request-ID`. The SDK
exposes it on `ProxiesApiError`:

```ts
try {
  await proxies.poolKeys.create({ label: 'alice' });
} catch (err) {
  if (err instanceof ProxiesApiError) {
    logger.error({
      msg: 'pool-key mint failed',
      status: err.status,
      requestId: err.requestId,        // ← paste this in support tickets
      body: err.body,
    });
  }
  throw err;
}
```

When opening a support ticket with Proxies.sx, include `err.requestId`.
That's how we look up your request server-side without you having to
describe what time it happened, what it was, etc.

---

## What didn't change

- `regenerate()` still returns `{ id, key }` — the rest of the
  `PoolAccessKey` fields are now also present on the response (it
  returns the full record), but destructuring `{ id, key }` continues
  to work.
- `Country` is still assignable from `'us' | 'de' | ...` literals. The
  type widened to `KnownCountry | (string & {})` so future-supported
  countries don't require a SDK bump, but autocomplete still suggests
  the known set.
- All public method signatures.
- Error class names and inheritance (`ProxiesError` → `ProxiesApiError`
  / `ProxiesTimeoutError` / `ProxiesConfigError`).

---

## Removing now-unnecessary code

After migrating, you should be able to delete:

- Any custom retry wrapper.
- Any "compute new expiresAt" helper.
- Any code that does `list().then(filter)` to fetch a known id.
- Any logging that recorded a self-generated `request_id` for support
  correlation.

That's typically 50–150 lines of code per integration. The savings
compound over time as more devs touch the codebase.

---

## Bumping

```bash
pnpm up @proxies-sx/pool-sdk@0.3.0
# or
npm i @proxies-sx/pool-sdk@^0.3.0
```

Then run your existing tests — they should still pass. If you depended
on transient failures throwing fast (instead of being retried), set
`retry: false` on the client constructor.
