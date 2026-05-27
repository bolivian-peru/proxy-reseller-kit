---
name: proxies-sx-pool-portal
description: Build a branded mobile-proxy reseller business or embed Proxies.sx mobile/residential proxies into any user-facing app. Trigger this skill whenever the user wants to resell proxies, mint per-customer access keys (pak_*), embed a proxy dashboard into their site, deploy a Next.js proxy storefront, integrate the Proxies.sx Pool Gateway, build a customer-facing proxy product, or add 4G/5G mobile proxies to ANY stack — JavaScript, TypeScript, React, Next.js, Python, PHP, Ruby, Go, Rust, or plain curl. Use it the moment the user says "mobile proxy", "proxy reseller", "pak_ keys", "pool gateway", "proxy dashboard", "embed proxies", "white-label proxy", or anything implying customer-facing proxy delivery — even if they don't explicitly ask for "this skill".
---

# Proxies.sx Pool Portal — Reseller Toolkit

Open-source toolkit for embedding the [Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy) into customer-facing apps. Three layers, three audiences:

1. **`@proxies-sx/pool-sdk`** — typed REST client (npm). For JS/TS code that mints `pak_` keys, lists usage, and builds proxy URLs.
2. **`@proxies-sx/pool-portal-react`** — drop-in `<PoolPortal />` component + headless hooks + `createPoolApiHandlers()` Next.js route factory.
3. **REST API** — language-agnostic. Anyone with an HTTP client (Python, PHP, Go, Ruby, bash + curl, …) can integrate.

Source: <https://github.com/bolivian-peru/proxy-reseller-kit>. License: MIT.

---

## When to use this skill

Use it for any of these intents:

- "I want to resell mobile proxies under my own brand"
- "Embed a proxy dashboard in my customer portal"
- "Mint a sub-key per paying customer"
- "Add proxy access to my [SaaS / scraping shop / ad platform]"
- "Wire Proxies.sx into my [Next.js / React / Vue / PHP / Python / Go] app"
- "I want a Stripe-paid proxy storefront"
- "Build a `pak_` key minting flow"

If the user mentions Pool Gateway, `pak_` keys, `psx_` reseller keys, `gw.proxies.sx:7000`, or any of the SDK/component names above, this skill applies.

---

## Decide the integration path FIRST

Before writing code, ask **two** orthogonal questions. Don't guess — the implementation differs significantly.

### Q1 — Which side of the dashboard is this?

For any non-trivial reseller deployment you want **TWO separate dashboards**:

```
┌──────────────────────────┐         ┌───────────────────────────┐
│  Reseller Admin Panel    │         │   Customer Dashboard      │
│  (e.g. admin.brand.com)  │         │  (e.g. dashboard.brand.com) │
├──────────────────────────┤         ├───────────────────────────┤
│ Audience: reseller staff │         │ Audience: end-customers   │
│ Auth: admin/staff role   │         │ Auth: customer JWT/cookie │
│                          │         │                           │
│ • Manage tariffs/pricing │         │ • See own pak_ + usage    │
│ • CRUD customers         │         │ • Spawn proxy URLs        │
│ • Top-up customer balance│         │ • Manage own sessions     │
│ • Mint/revoke pak_ keys  │         │ • Top up own balance      │
│ • View aggregate stats   │         │ • Read DSL docs           │
│ • Set custom rates       │         │                           │
│ • Audit log              │         │                           │
│                          │         │                           │
│ Built with: existing     │         │ Built with: <PoolPortal>, │
│   admin framework — does │         │   <PoolSessionSpawner>,   │
│   NOT use pool-portal-   │         │   <ActiveSessionsTable>,  │
│   react components.      │         │   <PoolDocsPanel>,        │
│                          │         │   <PoolStockGrid>         │
└──────────────────────────┘         └───────────────────────────┘
              │                                    │
              └────────┬───────────────────────────┘
                       ▼
            ┌────────────────────────┐
            │   Reseller backend     │
            │   (single source)      │
            ├────────────────────────┤
            │ ProxiesClient with     │
            │ psx_ API key —         │
            │ ALWAYS server-side.    │
            │                        │
            │ Admin routes call SDK  │
            │ directly (god-mode).   │
            │                        │
            │ Customer routes call   │
            │ via createPoolApi-     │
            │ Handlers() with        │
            │ getSessionUserId() +   │
            │ getUserKeyId() so each │
            │ customer only sees     │
            │ their own data.        │
            └────────────────────────┘
```

**Confirm with the user:** "Admin side, customer side, or both?" If they say "both" — build the customer side first (it's faster with the React components), then layer admin on their existing admin framework.

See [`docs/TWO-SIDED-DASHBOARD.md`](./docs/TWO-SIDED-DASHBOARD.md) for the full pattern with concrete examples and a Coronium-style reference architecture.

### Q2 — What's the integration shape for the side(s) you're building?

```
┌─────────────────────────────────────────────────────────────────────┐
│ Q1: Does the user already have an app, or are they starting fresh?  │
└─────────────────────────────────────────────────────────────────────┘
                  │                                  │
       fresh ─────┘                                  └───── existing
          │                                                    │
          ▼                                                    ▼
  PATH A: Clone the                                  ┌─────────────────────┐
  Next.js starter app                                │ Q2: What stack?     │
  (apps/starter/)                                    └─────────────────────┘
                                                         │              │
                                            React/Next.js               other
                                                         │              │
                                                         ▼              ▼
                                                  PATH B:        ┌──────────────┐
                                                  <PoolPortal/>  │ Q3: JS or no?│
                                                  component      └──────────────┘
                                                                  │           │
                                                                  JS/TS       not JS
                                                                  │           │
                                                                  ▼           ▼
                                                          PATH C:       PATH D:
                                                          SDK only      REST API direct
                                                          (no UI)       (any language)
```

Note: PATH B uses `<PoolPortal>` + `<PoolSessionSpawner>` + `<ActiveSessionsTable>` + `<PoolDocsPanel>` + `<PoolStockGrid>` for the **customer side**. The **admin side** typically uses PATH C (SDK only) layered on the reseller's existing admin framework — no SDK component is admin-shaped.

Confirm both Q1 (side) and Q2 (path) with the user before generating code.

---

## Prerequisites (all paths)

The user needs ONE thing first: a Proxies.sx reseller API key.

- Sign up / log in at [client.proxies.sx](https://client.proxies.sx)
- Visit [client.proxies.sx/account](https://client.proxies.sx/account)
- Click "Create API key" with scope `customers:write`
- Save the `psx_...` value — **server-side only, never expose to the browser**

The user will also have a "reseller username" of the form `psx_<id>` shown in the same dashboard. That value is safe to reference in proxy URLs (it's the public part of the proxy auth) — it's NOT the secret API key.

If the user doesn't have an API key yet, instruct them to mint one before any code runs. Don't try to mock it.

---

## PATH A — Deploy the full Next.js storefront

Use when the user wants a **complete branded reseller site** (landing page, magic-link login, Stripe checkout, customer dashboard) and is starting from scratch.

```bash
git clone https://github.com/bolivian-peru/proxy-reseller-kit.git my-shop
cd my-shop/apps/starter
cp .env.example .env
# Edit .env: PROXIES_SX_API_KEY, PROXIES_SX_USERNAME, STRIPE_SECRET_KEY,
#           STRIPE_WEBHOOK_SECRET, AUTH_SECRET, DATABASE_URL
pnpm install
docker compose up -d db        # local Postgres on :5432
pnpm db:migrate                # idempotent schema bootstrap
pnpm dev                       # → http://localhost:3000
```

In another terminal:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

**What you get out of the box:**
- `/` — landing + pricing tiers (configured in `src/config.ts`)
- `/login` — NextAuth (Auth.js v5) magic-link auth (in dev, the link prints to server console — no SMTP required)
- `/dashboard` — `<PoolPortal />` showing the customer's `pak_` key, country selector, copy-to-clipboard proxy URLs
- `/api/stripe/checkout` + `/api/stripe/webhook` — Stripe checkout that mints a `pak_` key on payment success
- `/api/pool/[...path]` — proxies SDK calls server-side (keeps `psx_` key off the client)

**Customize:** edit `apps/starter/src/config.ts`:
```ts
export const config = {
  brand: { name: 'AcmeProxies', primaryColor: '#7c3aed', supportEmail: '...' },
  pricing: [
    { id: 'starter', displayName: 'Starter', gb: 5,   priceUsd: 35 },
    { id: 'pro',     displayName: 'Pro',     gb: 25,  priceUsd: 150 },
    { id: 'scale',   displayName: 'Scale',   gb: 100, priceUsd: 500 },
  ],
  countries: ['us', 'de', 'pl', 'fr', 'es', 'gb'],
};
```

**Deploy:** `docker compose up --build -d` on a VPS with Caddy/nginx terminating TLS in front.

Full per-task guide: see `apps/starter/CLAUDE.md` in the repo.

---

## PATH B — Embed `<PoolPortal />` in an existing React/Next.js app

Use when the user already has auth, billing, and a UI shell, and just wants to drop a proxy dashboard onto a page.

```bash
npm install @proxies-sx/pool-portal-react @proxies-sx/pool-sdk
```

**Two pieces:** the component (client) + an API route (server, holds the secret).

### 1. Server route (Next.js App Router example)

`app/api/pool/[...path]/route.ts`:
```ts
import { createPoolApiHandlers } from '@proxies-sx/pool-portal-react/server';
import { auth } from '@/lib/auth'; // your existing auth

const handlers = createPoolApiHandlers({
  apiKey: process.env.PROXIES_SX_API_KEY!,
  proxyUsername: process.env.PROXIES_SX_USERNAME!,
  // CRITICAL: scope each request to the logged-in user so customer A
  // can never see customer B's keys.
  resolveCustomerContext: async () => {
    const session = await auth();
    if (!session?.user?.id) throw new Response('Unauthorized', { status: 401 });
    return { customerId: session.user.id };
  },
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
```

### 2. Page

`app/dashboard/page.tsx`:
```tsx
'use client';
import { PoolPortal } from '@proxies-sx/pool-portal-react';
import '@proxies-sx/pool-portal-react/styles.css';

export default function Dashboard() {
  return (
    <PoolPortal
      apiRoute="/api/pool"
      branding={{ name: 'AcmeProxies', primaryColor: '#7c3aed' }}
    />
  );
}
```

For non-Next.js React apps (CRA, Vite, Remix, etc.), implement the same handlers in your own backend framework — see headless hooks below for finer control.

### Headless hooks (custom UI)

If `<PoolPortal />` doesn't fit your design, use the hooks directly:
```tsx
import { usePoolKey, usePoolStock, useIncidents, useCopyToClipboard } from '@proxies-sx/pool-portal-react';

const { key, isLoading, regenerate } = usePoolKey({ apiRoute: '/api/pool' });
const { stock } = usePoolStock({ apiRoute: '/api/pool' });
```

---

## PATH C — Just the SDK (any JS/TS server)

Use when the user has a non-React frontend (Vue, Svelte, plain HTML) but a JS backend (Express, Fastify, Hono, Bun, Cloudflare Workers, …).

```bash
npm install @proxies-sx/pool-sdk
```

```ts
import { ProxiesClient } from '@proxies-sx/pool-sdk';

// Server-side ONLY. Never bundle PROXIES_SX_API_KEY into a browser build.
const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY!,
  proxyUsername: process.env.PROXIES_SX_USERNAME!,
});

// 1. Mint a key for a customer who just paid
const key = await proxies.poolKeys.create({
  label: `customer:${customerId}`,
  trafficCapGB: 10, // null/omit = unlimited within reseller's pool
});

// 2. Store key.id (for management) and key.key (the pak_ secret) in your DB
await db.update(customerId, { pakKeyId: key.id, pakKey: key.key });

// 3. Build the proxy URL the customer uses in their HTTP client
const proxyUrl = proxies.buildProxyUrl(key.key, {
  country: 'us',
  sid: customerId,    // sticky session — same customer = same exit IP
  rotation: 'sticky',
});
// → "http://psx_abc-mbl-us-sid-cust_7a3f9b-rot-sticky:pak_xyz@gw.proxies.sx:7000"
```

**Other operations:**
```ts
await proxies.poolKeys.list();                     // list all keys with usage + isExpired flag
await proxies.poolKeys.get(keyId);                 // fetch a single key (v0.3.0+)
await proxies.poolKeys.update(keyId, { label });   // update label / cap / enabled / expiresAt
await proxies.poolKeys.topUp(keyId, {              // atomic cap+expiry extension (v0.3.0+, preferred for top-ups)
  addTrafficGB: 10,
  extendDays: 30,
  idempotencyKey: `topup_${invoiceId}`,
});
await proxies.poolKeys.regenerate(keyId);          // rotate the secret (old pak_ stops working immediately)
await proxies.poolKeys.reveal(keyId);              // audit-logged unmask (v0.5.0+)
await proxies.poolKeys.audit({ limit: 50 });       // 90-day forensic log across all keys (v0.5.0+)
await proxies.poolKeys.auditForKey(keyId);         // forensic log for one key (v0.5.0+)
await proxies.poolKeys.delete(keyId);              // permanent
await proxies.pool.getStock();                     // live endpoint count by country
await proxies.pool.getIncidents();                 // active pool incidents
```

**Auto-suspend on cap (v0.5.0+):** when traffic crosses `trafficCapGB`, the platform flips `enabled=false` automatically. `topUp()` does NOT auto re-enable. For trusted payment paths, pair the call:
```ts
await proxies.poolKeys.topUp(keyId, { addTrafficGB: 10, idempotencyKey: invoiceId });
await proxies.poolKeys.update(keyId, { enabled: true });   // lift the suspend
```

**Time-bounded credits with `expiresAt` (v0.2.0+):**
```ts
// Mint a 60-day "use it or lose it" credit
const key = await proxies.poolKeys.create({
  label: 'customer:alice',
  trafficCapGB: 10,
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
  idempotencyKey: paymentIntentId,                 // safe to retry on 504 (v0.3.0+)
});

// On top-up — PREFERRED: atomic single-write, race-safe
await proxies.poolKeys.topUp(key.id, {
  addTrafficGB: 15,                                // server-side $inc
  extendDays: 60,                                  // expiresAt = max(now, current) + 60d
  idempotencyKey: `topup_${invoiceId}`,            // dedupes retries within 24h
});

// Remove the expiry (perpetual key) — still uses update()
await proxies.poolKeys.update(key.id, { expiresAt: null });

// Helpers
import { isPoolKeyExpired, daysUntilPoolKeyExpiry } from '@proxies-sx/pool-sdk';
isPoolKeyExpired(key);          // boolean
daysUntilPoolKeyExpiry(key);    // number | null
```

The gateway rejects expired keys **immediately** (no wait for the nightly cron). The platform's daily cron (03:30 UTC) sets `enabled=false` on past-expiry keys for tidier admin queries.

**Production-readiness (v0.3.0+):**
```ts
// Built-in retry on 5xx/429/timeouts/network errors. Default: 3 attempts.
// Honors Retry-After. Skip 4xx (except 429). Don't wrap your own retry.
const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY!,
  retry: { attempts: 3, baseDelayMs: 250, maxDelayMs: 4000 },  // these are the defaults
});

// Idempotency-Key on writes — safe to retry the same call after a 504
await proxies.poolKeys.create({
  label: 'customer:alice',
  trafficCapGB: 10,
  idempotencyKey: stripeSessionId,   // any 8-128 char [A-Za-z0-9_-]
});

// Request correlation for support tickets
try {
  await proxies.poolKeys.create({ label: 'alice' });
} catch (err) {
  if (err instanceof ProxiesApiError) {
    logger.error({ status: err.status, requestId: err.requestId, body: err.body });
    // Paste err.requestId in support tickets — it's the X-Request-ID server-side
  }
}
```

---

## PATH D — Direct REST API (PHP / Python / Go / Ruby / any language)

Use when the user's backend is **not JavaScript**. The SDK is a thin wrapper around a public REST API — anyone with an HTTP client can integrate.

**Auth:** `X-API-Key: psx_...` header on every request.

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/reseller/pool-keys` | Mint a `pak_` key. Accepts optional `expiresAt` (ISO datetime) and `Idempotency-Key` header. **Sensitive — see Fresh-Auth below.** |
| `GET` | `/v1/reseller/pool-keys` | List keys + usage (returns `expiresAt`, server-computed `isExpired`) |
| `GET` | `/v1/reseller/pool-keys/{keyId}` | Fetch a single key by id (v0.3.0+) |
| `PATCH` | `/v1/reseller/pool-keys/{keyId}` | Update `label` / `enabled` / `trafficCapGB` / `expiresAt` |
| `POST` | `/v1/reseller/pool-keys/{keyId}/topup` | Atomic cap-and/or-expiry extension (v0.3.0+). Body: `{addTrafficGB?, extendDays?}`. Accepts `Idempotency-Key` |
| `POST` | `/v1/reseller/pool-keys/{keyId}/regenerate` | Rotate secret (old pak_ stops working immediately). Returns full record from v0.3.0. **Sensitive.** |
| `POST` | `/v1/reseller/pool-keys/{keyId}/reveal` | Audit-logged unmask (returns full pak_ + records `reveal` event). Use this in customer-facing UIs instead of displaying the key from `list`. |
| `DELETE` | `/v1/reseller/pool-keys/{keyId}` | Delete permanently |
| `GET` | `/v1/reseller/pool-keys/audit` | 90-day forensic log across all keys. Filter via `?action=...`, paginate via `?before=<ISO>&limit=N` |
| `GET` | `/v1/reseller/pool-keys/{keyId}/audit` | 90-day forensic log scoped to one key |

**Three universal headers:**

- `Idempotency-Key: <8-128 char [A-Za-z0-9_-]>` on `POST`/`PATCH` — dedupes retries within 24h. Pass any unique-per-domain ID (UUIDv4, payment_intent_id, invoice_id). Same key in 24h returns the cached response instead of re-executing.
- `X-Request-ID` is set on every response by the platform. Echo it in your logs. Paste it in support tickets — that's how we look up your request server-side without back-and-forth.
- `X-Confirm-Password: <current_password>` — only required on **sensitive ops** (mint, regenerate) when the calling JWT was issued > 5 min ago. API-key callers bypass this entirely. See [Fresh-Auth Guard](#fresh-auth-guard) below.

### Fresh-Auth Guard

Sensitive ops (`POST /pool-keys` mint, `POST /:keyId/regenerate`) require recent authentication so a stolen JWT cookie can't be used to silently mint or rotate keys. Pass conditions in order:

1. **API-key auth** — `psx_` callers always pass. Server-side automation, compensated by per-key rate limit + audit log.
2. **Fresh JWT** — token's `iat` < 5 min old. Just-signed-in users get through.
3. **Step-up password** — send `X-Confirm-Password: <current_password>`. Backend bcrypt-checks against the user's account password.

Failure response:
```json
{ "statusCode": 401, "code": "FRESH_AUTH_REQUIRED", "freshWindowMinutes": 5 }
```
On wrong confirm password: `{ "code": "FRESH_AUTH_INVALID_PASSWORD" }`.

UI pattern: catch `FRESH_AUTH_REQUIRED`, prompt the user for their current password, retry with the header set. The Proxies.sx customer portal does this automatically. See `customer-proxies-sx-main/src/pages/PoolKeys.tsx` for a reference implementation.

### Auto-Suspend on Cap Exceeded

When traffic crosses `trafficCapGB`, the platform flips `enabled = false` automatically and writes an `auto_suspended_cap_exceeded` audit event. Your reseller must inspect and explicitly top up + re-enable. Don't paper over this with a webhook auto-recreate — the suspend is intentional, to limit blast radius if the key was compromised.

Base URL: `https://api.proxies.sx/v1`. OpenAPI: <https://api.proxies.sx/docs/api-json>. Swagger UI: <https://api.proxies.sx/docs/api>.

### Mint a key — minimum viable curl

```bash
curl -X POST https://api.proxies.sx/v1/reseller/pool-keys \
  -H "X-API-Key: psx_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"customer:alice@example.com","trafficCapGB":10}'

# Response:
# {
#   "id": "65f...",
#   "key": "pak_a1b2c3...",
#   "label": "customer:alice@example.com",
#   "trafficCapGB": 10,
#   "trafficUsedGB": 0,
#   "enabled": true,
#   "createdAt": "..."
# }
```

### Per-language patterns

**Python:**
```python
import requests

resp = requests.post(
    "https://api.proxies.sx/v1/reseller/pool-keys",
    headers={"X-API-Key": "psx_YOUR_API_KEY"},
    json={"label": "customer:alice", "trafficCapGB": 10},
)
key = resp.json()["key"]  # "pak_..."
```

**PHP:**
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
body := strings.NewReader(`{"label":"customer:alice","trafficCapGB":10}`)
req, _ := http.NewRequest("POST", "https://api.proxies.sx/v1/reseller/pool-keys", body)
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

---

## The proxy URL grammar (every path uses this)

The customer's HTTP/SOCKS5 client connects to:
```
{protocol}://{username}:{pakKey}@gw.proxies.sx:{port}
```

| Field | Value |
|---|---|
| `protocol` | `http` or `socks5` |
| `port` | `7000` for HTTP, `7001` for SOCKS5 |
| `username` | `psx_RESELLER_USERNAME` + optional `-`-separated tokens |
| `pakKey` | The `pak_*` secret minted via the API |

**Tokens inside the username** (all optional, in any order, separated by `-`):

| Token | Example | Meaning |
|---|---|---|
| Pool | `mbl`, `peer` | `mbl` = ProxySmart mobile modems (default), `peer` = residential peer devices |
| Country | `us`, `de`, `pl`, `fr`, `es`, `gb` | ISO 3166-1 alpha-2 |
| `sid-{id}` | `sid-alice_session1` | Sticky session — same `sid` keeps the same exit IP |
| `rot-{mode}` | `rot-sticky`, `rot-auto10`, `rot-auto30`, `rot-hard`, `rot-none` | IP rotation policy |
| `city-{name}` | `city-nyc` | City filter (when supported) |
| `carrier-{name}` | `carrier-att`, `carrier-tmobile` | Carrier filter |

**Example URL:**
```
http://psx_acme-mbl-us-sid-customer123-rot-sticky:pak_a1b2c3@gw.proxies.sx:7000
```

This says: route customer123's traffic through US mobile modems, keep the same exit IP for the session.

The SDK's `buildProxyUrl(pakKey, opts)` generates this. In other languages, build the string manually:

```python
def build_proxy_url(reseller, pak_key, country='us', sid=None, rotation='sticky'):
    parts = [reseller, 'mbl', country]
    if sid: parts.append(f'sid-{sid}')
    if rotation: parts.append(f'rot-{rotation}')
    return f"http://{'-'.join(parts)}:{pak_key}@gw.proxies.sx:7000"
```

---

## Error handling

The REST API returns standard HTTP codes. Map them like this:

| Status | Meaning | Action |
|---|---|---|
| `200` / `201` | Success | Use the response body |
| `400` | Validation error | Show error details to the user, don't retry |
| `401` | API key invalid or revoked | Re-mint key from `client.proxies.sx/account` |
| `403` | Scope insufficient | Add `customers:write` to the key |
| `404` | Key doesn't exist | Stop — don't loop |
| `429` | Rate-limited | Back off (exponential, start at 1s) |
| `500–599` | Server error | Retry up to 3× with exponential backoff |

The SDK ships these as typed errors:
```ts
import { ProxiesApiError, ProxiesTimeoutError } from '@proxies-sx/pool-sdk';
try { await proxies.poolKeys.create({ label: 'x' }); }
catch (err) {
  if (err instanceof ProxiesApiError) {
    if (err.isAuth)        { /* 401/403 */ }
    if (err.isRateLimited) { /* 429 */ }
    if (err.isServer)      { /* 5xx */ }
  } else if (err instanceof ProxiesTimeoutError) {
    /* request exceeded timeout */
  }
}
```

---

## Security non-negotiables

DO NOT skip these. Burn them into any code generated for the user:

1. **`PROXIES_SX_API_KEY` is server-only.** Never inline it in `next.config.js`, never `NEXT_PUBLIC_*` it, never ship it to the browser bundle. The trust boundary lives at your backend.
2. **Scope every request** by the authenticated customer. In the React PATH B example, `resolveCustomerContext` MUST read the session — without it, customer A can read/regenerate customer B's keys.
   - ⚠️ **Session routes are an exception on the published 0.5.x packages.** `createPoolApiHandlers()`'s `/my-sessions` GET + DELETE routes are **NOT** scoped per-customer on `@proxies-sx/pool-portal-react@0.5.x` — `sessions.list()/close()/closeAll()` take no args and `ActiveSession` has no `pakKeyId`. Any signed-in customer can list/close/wipe **other** customers' sessions by calling the route directly (even with the UI hidden). For multi-tenant apps you MUST lock these routes down at your route layer (return `{sessions:[],count:0}` for GET, `403` for DELETE) and omit `<ActiveSessionsTable>` until you upgrade to `0.6.x` (which scopes them natively via `getUserKeyId` → `{ pakId }`). Copy-paste fix: `RESELLER-UPDATE-PROMPT` in the repo root + the React README "Session routes — multi-tenant security". Confirm the version with `npm view @proxies-sx/pool-portal-react version` before assuming 0.6.x is available.
3. **Use parameterized SQL** if you're storing keys (the starter app does this — `$1`, `$2` placeholders, never string interpolation).
4. **Verify Stripe webhook signatures.** The starter app's webhook handler does this; if you adapt it, do not comment out the signature check "to test".
5. **Rotate leaked `pak_` keys immediately** via `regenerate()` — the old value is invalidated within ~1 second.
6. **Store `psx_` keys in a secrets manager**, not in source. The starter uses `.env`; production deployments should use 1Password / Doppler / AWS Secrets Manager / etc.

## Pool IPs are not publicly enumerable (May 2026)

The Proxies.sx pool gateway intentionally hides the per-device exit IP and carrier from any unauthenticated caller. This is unusual for shared-proxy services — most expose their inventory through a public "available IPs" endpoint, which anti-bot vendors (DataDome, PerimeterX, Cloudflare Bot Manager, Akamai) scrape and pre-blacklist before any customer routes traffic.

Concretely, after the May 19 2026 lockdown:

- `GET /v1/peer/board`, `/v1/peer/proxy/devices`, `/v1/peer/proxy/credentials`, `/v1/peer/proxy/test/*`, `/v1/peer/proxy/connect-string/*`, `/v1/peer/stats/online`, and `/v1/peer/devices` all require an admin JWT/API key. Anonymous calls return HTTP 401.
- `relay.proxies.sx/health` returns only `{"status":"ok"}` to anonymous probes (full fleet list requires the internal key).
- `currentIp` is stripped at the service layer from any peer/board response, even on the admin path — defense in depth against accidental re-exposure through a future change.
- Customers route through `gw.proxies.sx:7000` (HTTP CONNECT) or `:7001` (SOCKS5) with their `pak_` key. The Lua selector inside the gateway picks the modem; the customer never learns which device they were assigned to.
- The customer-facing `GET /v1/gateway/pool/availability` returns coarse country counts only (e.g. `{US: 40, GB: 20}`), never IPs.

This means a reseller built on this stack inherits a clean IP-reputation posture out of the box. If you mention this in your own marketing copy, you're not over-claiming — the lockdown is enforced server-side and verifiable by hitting any of the listed endpoints from an unauthenticated client (they all 401).

---

## Common patterns

### Customer pays → mint key (Stripe webhook)

```ts
// Pseudocode — works in any framework
async function onStripeCheckoutCompleted(event) {
  const session = event.data.object;
  const customerId = session.client_reference_id;
  const gbPurchased = Number(session.metadata.gb);

  const key = await proxies.poolKeys.create({
    label: `customer:${customerId}`,
    trafficCapGB: gbPurchased,
  });

  await db.update(customerId, { pakKeyId: key.id, pakKey: key.key });
}
```

### Customer wants to rotate their own credentials

```ts
async function rotateForCustomer(customerId) {
  const customer = await db.get(customerId);
  const { id, key } = await proxies.poolKeys.regenerate(customer.pakKeyId);
  await db.update(customerId, { pakKey: key });
  return key; // hand to UI
}
```

### Show usage on dashboard

```ts
const keys = await proxies.poolKeys.list();
const ours = keys.find(k => k.id === customer.pakKeyId);
console.log(`${ours.trafficUsedGB} / ${ours.trafficCapGB ?? '∞'} GB used`);
```

### Top-up: customer pays for more, increase the cap

```ts
await proxies.poolKeys.update(customer.pakKeyId, {
  trafficCapGB: customer.trafficCapGB + additionalGB,
});
```

---

## Pricing (do NOT pin numbers in code or docs)

Wholesale rates from Proxies.sx have volume tiers. Do not hardcode dollar amounts in the user's app — they are configured by the platform and can change.

To get current rates programmatically:
- `GET https://api.proxies.sx/v1/x402/pricing` (public, no auth)
- Or check the user's [client.proxies.sx](https://client.proxies.sx) dashboard

The user sets their **retail** price (whatever they charge their own customers) — that lives in their own app config (`apps/starter/src/config.ts` in the starter, or wherever they put it). Our wholesale price affects their margin, not their pricing UI.

---

## Reference files (deeper detail)

When the user needs more than this skill provides, point them to the right file in the repo:

| File | When to read |
|---|---|
| `README.md` | Marketing-friendly overview, FAQ, license |
| `packages/sdk/README.md` | Full SDK API surface, all methods, error types, language-by-language REST examples |
| `packages/react/README.md` | `<PoolPortal />` props, all hooks, server handler details, theming |
| `apps/starter/README.md` | Full Next.js storefront deployment guide |
| `apps/starter/CLAUDE.md` | Per-task instructions for AI agents customizing the starter (change brand, add country, add admin page, change DB schema) |
| `CLAUDE.md` | Repo-wide architecture + invariants for AI agents working ON the SDK code itself |
| `SECURITY.md` | Production hardening checklist |

---

## Quick smoke test (run before reporting "done" to the user)

After generating code, verify the integration works end-to-end. Don't trust types alone.

```bash
# 1. Mint a real key (replace YOUR_KEY with the user's real psx_ key)
RESPONSE=$(curl -s -X POST https://api.proxies.sx/v1/reseller/pool-keys \
  -H "X-API-Key: psx_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"smoke-test","trafficCapGB":1}')
PAK=$(echo "$RESPONSE" | grep -oE 'pak_[a-z0-9]+')
echo "Got key: $PAK"

# 2. Use it through the gateway (USERNAME = the user's psx_ reseller username)
curl -x "http://USERNAME-mbl-us:$PAK@gw.proxies.sx:7000" https://api.ipify.org
# Should return a US mobile IP.

# 3. Clean up
KEY_ID=$(echo "$RESPONSE" | grep -oE '"id":"[^"]+"' | cut -d'"' -f4)
curl -X DELETE "https://api.proxies.sx/v1/reseller/pool-keys/$KEY_ID" \
  -H "X-API-Key: psx_YOUR_KEY"
```

If step 2 returns a real US IP via the proxy, the integration works.

---

## Final checklist before handing off

- [ ] User has a `psx_*` API key from `client.proxies.sx/account`
- [ ] The key is in a server-side env var, never in client code
- [ ] If using PATH B/C, the API route scopes by authenticated user
- [ ] Stripe webhook signature is verified (if using Stripe)
- [ ] User can mint a `pak_*`, build a proxy URL, and route real traffic through it
- [ ] User knows how to regenerate a leaked `pak_*`
- [ ] No specific pricing numbers were hardcoded — UI either reads `/v1/x402/pricing` or shows the user's own retail tiers
