# @proxies-sx/pool-sdk

[![npm](https://img.shields.io/npm/v/@proxies-sx/pool-sdk)](https://www.npmjs.com/package/@proxies-sx/pool-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)

> Typed TypeScript/JavaScript client for the **[Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy)** reseller API. Mint Pool Access Keys, build proxy URLs, and ship a branded reseller business in an hour instead of a month.

Wholesale pricing with volume tiers — current rates in your [client.proxies.sx](https://client.proxies.sx) dashboard or via [api.proxies.sx/v1/x402/pricing](https://api.proxies.sx/v1/x402/pricing). You set your resale price. One API call mints a per-customer sub-key with its own traffic cap.

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

// Mint a key for a customer who just paid
const key = await proxies.poolKeys.create({
  label: 'customer:alice@example.com',
  trafficCapGB: 10,
});

// Build the proxy URL they'll use in their HTTP client
const url = proxies.buildProxyUrl(key.key, {
  country: 'us',
  sid: 'alice_session1',
  rotation: 'sticky',
});
// → "http://psx_abc123-mbl-us-sid-alice_session1-rot-sticky:pak_...@gw.proxies.sx:7000"

// Hand the URL to the customer
await email(customer, url);
```

That's the whole flow. Everything else is bookkeeping.

---

## API surface

### `new ProxiesClient(config)`

```ts
interface ClientConfig {
  apiKey: string;              // Required. psx_... from client.proxies.sx/account
  proxyUsername?: string;      // e.g. "psx_abc123" — required to call buildProxyUrl
  baseUrl?: string;            // Default: "https://api.proxies.sx/v1"
  gatewayHost?: string;        // Default: "gw.proxies.sx"
  timeout?: number;            // Default: 30000 (ms)
  retry?: false | RetryConfig; // Default: 3 attempts, 250/1000/4000ms (v0.3.0+)
  fetch?: typeof fetch;        // Override for older Node or mocking
}

interface RetryConfig {
  attempts?: number;       // Default 3 (1 = no retries)
  baseDelayMs?: number;    // Default 250
  maxDelayMs?: number;     // Default 4000
}
```

The SDK retries on `5xx`, `429`, timeouts, and network errors. It does
NOT retry on `4xx` (other than `429`) — those are programmer errors.
Honors the `Retry-After` header on `429`. **Don't wrap your own retry**
on top — it causes thundering herd. To disable, pass `retry: false`.

### `proxies.poolKeys`

| Method | Returns | Description |
|---|---|---|
| `create({ label, trafficCapGB?, expiresAt?, idempotencyKey? })` | `PoolAccessKey` | Mint a new key |
| `list()` | `PoolAccessKey[]` | List all your keys with usage |
| `get(keyId)` | `PoolAccessKey` | Fetch a single key by id |
| `update(keyId, { label?, enabled?, trafficCapGB?, expiresAt? })` | `PoolAccessKey` | Change any field |
| `topUp(keyId, { addTrafficGB?, extendDays?, idempotencyKey? })` | `PoolAccessKey` | Atomically extend cap and/or expiry — use this for top-up flows |
| `regenerate(keyId, { idempotencyKey? }?)` | `PoolAccessKey` | Rotate the secret value (invalidates old). Returns full record from 0.3.0+ |
| `reveal(keyId)` (v0.5.0+) | `PoolAccessKey` | Audit-logged unmask. Records a `reveal` event server-side. Use in customer-facing dashboards instead of displaying `key` from `list()` |
| `audit({ action?, before?, limit? }?)` (v0.5.0+) | `PoolAccessKeyAuditEvent[]` | Forensic log across ALL of your keys (90-day TTL). Filter by action, paginate via `before` |
| `auditForKey(keyId, { before?, limit? }?)` (v0.5.0+) | `PoolAccessKeyAuditEvent[]` | Forensic log for a single key |
| `delete(keyId)` | `void` | Permanently delete |

#### Auto-suspend on cap exceeded (server-side, v0.5.0+)

When a key's `trafficUsedMB / 1024 ≥ trafficCapGB`, the platform atomically flips `enabled = false` and writes an `auto_suspended_cap_exceeded` audit event. **`topUp()` does NOT auto re-enable.** This is intentional — caps financial blast radius if a key leaks. For trusted top-up flows (e.g., a confirmed Stripe payment from the actual account owner), pair `topUp` + explicit `update`:

```ts
await proxies.poolKeys.topUp(keyId, { addTrafficGB: 10, idempotencyKey: invoiceId });
await proxies.poolKeys.update(keyId, { enabled: true });   // ← lift the suspend
```

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

#### `psx_` API-key callers bypass FreshAuthGuard

The platform requires recent auth (JWT < 5 min OR `X-Confirm-Password`) for `POST /pool-keys` and `POST /:keyId/regenerate` from interactive sessions. **Server-side `psx_` callers (this SDK) bypass it entirely** — no code change needed. Compensating controls: per-key rate limit + audit log.

### `proxies.sessions` (v0.4.0+)

Live gateway session management for the current reseller's customers.

| Method | Returns | Description |
|---|---|---|
| `list()` | `{ sessions: ActiveSession[]; count: number }` | All live sessions for the current account, with `proxyUrl`/`socks5Url` template strings (`<PASSWORD>` placeholder) |
| `close(sessionKey)` | `{ success, message }` | Close one session. Idempotent + ownership-checked server-side |
| `closeAll()` | `{ success, count }` | Close all live sessions for the current user |

```ts
const { sessions } = await proxies.sessions.list();
for (const s of sessions) {
  if (s.isSynthesizedSid) continue;            // hide internal auto_/socks5_ ids
  const url = s.proxyUrl.replace('<PASSWORD>', myPak);
  console.log(s.country, s.currentIp, s.ttl + 's left →', url);
}
await proxies.sessions.close('gw:session:psx_xxx:bot07');
```

`ActiveSession` carries `country`, `pool`, `currentIp`, `bytesIn/Out`,
`requestCount`, `ttl`, `expiresAt`, `rotation`, `proxyUrl`, `socks5Url`,
`isSynthesizedSid`. See [CHANGELOG.md](./CHANGELOG.md#040--sessions-api-multi-port-spawner-ux)
for full type details.

#### Idempotency on writes (v0.3.0+)

`create()`, `topUp()`, and `regenerate()` accept an `idempotencyKey`
(any 8-128 char `[A-Za-z0-9_-]` value). The platform dedupes within
a 24h window — retried calls return the cached response instead of
creating a second resource. Tie it to a domain object for effortless
correlation:

```ts
// In your Stripe webhook handler:
const key = await proxies.poolKeys.create({
  label: `customer:${session.customer}`,
  trafficCapGB: 10,
  idempotencyKey: session.id,   // safe to retry on 504
});

// On a top-up triggered by an invoice:
await proxies.poolKeys.topUp(keyId, {
  addTrafficGB: 10,
  extendDays: 30,
  idempotencyKey: `topup_${invoiceId}`,
});
```

If you omit `idempotencyKey`, the call is NOT idempotent — a network
retry could mint a second key. Always pass one in webhook/payment paths.

#### Expiry — `expiresAt` (v0.2.0+)

Ship time-bounded GB credits ("10 GB, use within 60 days") by passing an
`expiresAt` (ISO datetime or `Date`) on `create` / `update`. Past the
expiry, the gateway rejects the key immediately, and our nightly cron
flips `enabled=false` on the record.

```ts
// Mint with a 60-day expiry
const key = await proxies.poolKeys.create({
  label: 'customer:alice',
  trafficCapGB: 10,
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
});

// PREFERRED on top-up: atomic single-write, race-safe, idempotent
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
| `getStock()` | `PoolStock` | Live endpoint count per country |
| `getIncidents()` | `Incident[]` | Active pool incidents |

### `proxies.buildProxyUrl(pakKey, opts?)`

Instance method using your configured `proxyUsername` and `gatewayHost`.

### `buildProxyUrl(proxyUsername, pakKey, opts?)`

Standalone function — use it if you don't have a client instance on hand.

```ts
import { buildProxyUrl } from '@proxies-sx/pool-sdk';
```

**`opts`:**

| Field | Type | Example |
|---|---|---|
| `country` | `'us' \| 'de' \| 'pl' \| 'fr' \| 'es' \| 'gb'` | `'us'` |
| `carrier` | `string` | `'att'`, `'tmobile'`, `'vodafone'` |
| `city` | `string` | `'nyc'`, `'berlin'` |
| `sid` | `string` | `'customer-123'` (same sid = same endpoint with `rotation: 'sticky'`) |
| `rotation` | `'none' \| 'auto10' \| 'auto30' \| 'sticky' \| 'hard'` | `'sticky'` |
| `pool` | `'mbl' \| 'peer'` | `'mbl'` (mobile modems) or `'peer'` (residential peers) |
| `protocol` | `'http' \| 'socks5'` | `'http'` (port 7000) or `'socks5'` (port 7001) |
| `host` | `string` | Override gateway host, e.g. `'edge-eu.proxies.sx'` |

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

  const key = await proxies.poolKeys.update(customer.pakKeyId, {}); // no-op fetch to get latest usage
  const url = proxies.buildProxyUrl(customer.pakKey, {
    country: 'us',
    sid: customer.id,
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
  await proxies.poolKeys.create({ label: 'test' });
} catch (err) {
  if (err instanceof ProxiesApiError) {
    // err.requestId is the X-Request-ID server-side — paste it in support tickets
    logger.error({ status: err.status, requestId: err.requestId, body: err.body });

    if (err.isAuth) {
      // 401/403 — API key invalid or revoked
    } else if (err.isRateLimited) {
      // 429 — already retried by the SDK; surface to user
    } else if (err.isServer) {
      // 5xx — already retried by the SDK; surface to user
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
- If a `pak_` key leaks, call `proxies.poolKeys.regenerate(keyId)`. The old value stops working immediately.
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
| `POST` | `/v1/reseller/pool-keys/:keyId/topup` | Atomic cap-and/or-expiry extension (v0.3.0+) |
| `POST` | `/v1/reseller/pool-keys/:keyId/regenerate` | Rotate the secret (old value invalidated immediately) |
| `DELETE` | `/v1/reseller/pool-keys/:keyId` | Permanently delete |

**Idempotency:** `POST` and `PATCH` endpoints accept an `Idempotency-Key`
header. Same key within 24h → cached response. Use it on every retry-prone
write (webhook handlers, payment flows).

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

**The proxy URL itself is plain HTTP Basic auth** — works with any HTTP/SOCKS5 client in any language. The username carries optional config tokens:

```
http://psx_RESELLER_USERNAME-mbl-us-sid-alice_session1-rot-sticky:pak_CUSTOMER_KEY@gw.proxies.sx:7000
```

Token format inside the username (separated by `-`):
- `mbl` / `peer` — pool type (mobile modems vs residential peers)
- `us` / `de` / `pl` / `fr` / `es` / `gb` — country code
- `sid-<id>` — sticky session id (same `sid` = same exit IP for the session)
- `rot-sticky` / `rot-auto10` / `rot-auto30` / `rot-hard` / `rot-none` — rotation mode
- `city-<name>` / `carrier-<name>` — optional filters

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

**Full OpenAPI spec:** [api.proxies.sx/docs/api-json](https://api.proxies.sx/docs/api-json) (interactive at [api.proxies.sx/docs/api](https://api.proxies.sx/docs/api))

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
