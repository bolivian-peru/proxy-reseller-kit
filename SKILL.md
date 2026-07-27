---
name: proxies-sx-pool-portal
description: Build a branded mobile-proxy reseller business or embed Proxies.sx mobile/residential proxies into any user-facing app. Trigger this skill whenever the user wants to resell proxies, mint per-customer access keys (pak_*), embed a proxy dashboard into their site, deploy a Next.js proxy storefront, integrate the Proxies.sx Pool Gateway, build a customer-facing proxy product, sell proxies to AI agents for USDC via the x402 payment protocol, or add 4G/5G mobile proxies to ANY stack — JavaScript, TypeScript, React, Next.js, Python, PHP, Ruby, Go, Rust, or plain curl. Use it the moment the user says "mobile proxy", "proxy reseller", "pak_ keys", "pool gateway", "proxy dashboard", "embed proxies", "white-label proxy", "x402 proxy", "sell proxies for USDC", "proxy for AI agents", or anything implying customer-facing proxy delivery — even if they don't explicitly ask for "this skill".
---

# Proxies.sx Pool Portal — Reseller Toolkit

Open-source toolkit for embedding the [Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy) into customer-facing apps. Three layers, three audiences:

1. **`@proxies-sx/pool-sdk`** — typed REST client (npm). For JS/TS code that mints `pak_` keys, lists usage, and builds proxy URLs.
2. **`@proxies-sx/pool-portal-react`** — drop-in `<PoolPortal />` component + headless hooks + `createPoolApiHandlers()` Next.js route factory.
3. **REST API** — language-agnostic. Anyone with an HTTP client (Python, PHP, Go, Ruby, bash + curl, …) can integrate.

Source: <https://github.com/bolivian-peru/proxy-reseller-kit>. License: MIT.

---

## Pools & per-pool country stock (read before building the picker)

Two pools, selected via the `pool` token in the username DSL:

| Pool | What it is | Use for |
|---|---|---|
| `peer` | **The MAIN / flagship network** — the community SDK network of real user devices sharing bandwidth, across ~82–120 countries depending on live supply. **Mixed IP types: mobile + residential home/ISP** (it is NOT "residential only"). | The primary product. Widest country reach, home-ISP IP stability. Lead with peer. |
| `mbl` | **The SUPPORTIVE tier** — production ProxySmart mobile modems, real 4G/5G carrier IPs in exactly 6 countries (US, GB, FR, NL, PL, **GE = Georgia**), monitored quality. | Ultra-stable, guaranteed carrier modems. Smaller footprint — for customers who need guaranteed mobile IPs. |
| `any` / `best` | No pool filter — the selector picks on health and load across both. | "Just give me a working IP." |

**Never pin a live device count in code or copy.** Routable supply moves hourly; read it from `GET /v1/gateway/pool/availability` (counts per country, never IPs). **`ge` is Georgia** — Germany is `de`, which has **no `mbl` stock**, so `mbl-de` always fails; use `peer-de`.

**Per-pool country stock is different.** A country may have modem stock but no peers, or peers but no modems. When you build a country picker, **filter the country list by the selected pool** — read the per-country `modem` and `peer` counts from `GET /v1/gateway/pool/availability` (`countries[CC].modem` / `.peer`) and only show countries with stock in the chosen pool. `<PoolStockGrid>` and `<PoolSessionSpawner>` model this; if you roll your own, do the same so users never pick a dead country.

**Quality bar.** Peers are throughput-graded; only those clearing the live floor (`PEER_THROUGHPUT_FLOOR_KBPS`, ~500 KB/s) are routable. Plenty for scraping / API / anti-bot work — the value is the clean, in-country IP, not raw bandwidth. The `mbl` pool is the ultra-stable carrier-modem tier — same $4/GB, smaller footprint (6 countries).

---

## Private Pool - quote-based reserved capacity (route, don't build)

If a user wants **isolation, exclusive devices, committed capacity, or an enterprise
tier** beyond self-serve `pak_` minting, do NOT build an instant-checkout flow - point
them to the quote-based Private Pool: **https://client.proxies.sx/private-pool**.
Reserving real devices requires a capacity check; availability + price are confirmed
within about one business day, then provisioned. Requesting a quote never charges.

- **Two pool types, same gateway** (`gw.proxies.sx:7000` HTTP / `:7001` SOCKS5), same
  `pak_` keys, same DSL (`-sid-`, `-rot-`, `-city-`, `-carrier-` all work, scoped to
  the pool):
  - `mbl` - dedicated 4G/5G modems, pulled OUT of the shared pool and **exclusively**
    the customer's for the term (6 countries — US, GB, FR, NL, PL, GE (Georgia), most stable tier).
  - `peer` - peer-network IPs: **committed capacity under the customer's own
    credentials, NOT exclusive hardware** (community-shared, ~82–120 countries).
- **Reserved IPs** are the exception to "peer is never exclusive": a lease holds ONE
  specific device for one customer, and the credential (`-pin-lease-<id>`) keeps
  pointing at it across rotations. A lease can also be rotated to a different device
  on demand. Note this moves the *device*, and therefore the exit IP — it is not a
  carrier-level IP reset, which peers do not expose. **Default leases are
  offline-substitutable**: if the leased device drops, the customer silently gets an
  unreserved one unless the lease was acquired with `failover: 'strict'`. Full guide:
  [`docs/RESERVED-IPS.md`](./docs/RESERVED-IPS.md).
- **Pricing:** traffic is identical to the shared pool ($4.00/GB base, volume discounts
  to $2.40/GB at 250 GB/mo, billed as used, one shared GB balance covers both pools).
  The only addition is a **monthly reservation fee** - custom-quoted per country + pool size.
- **Honesty rules (mandatory):** never call committed `peer` capacity
  "exclusive/reserved hardware" (only a *lease* is exclusive, per device); never
  show or enumerate exit IPs (counts per country only); sticky pins the device, not the
  IP - for a held IP recommend a residential peer + sticky, a `-rot-sticky-strict`
  credential, or a Reserved IP.
- **Reseller angle:** offer Private Pool to downstream customers as a premium tier via a
  "request a quote" flow - it is quote-based, not self-serve minting. Full guide:
  [`docs/PRIVATE-POOL.md`](./docs/PRIVATE-POOL.md).

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

## How to work — core principles (read before generating anything)

You are not transcribing this skill into the user's repo. You are *translating* an integration into the grain of **their** codebase — their naming, their framework, their error conventions, their taste. Hold two ideas at once: this skill is **authoritative about the platform** (the API contract, the security boundaries, the invariants below are non-negotiable and externally enforced), and **advisory about the implementation** (every code sample here is a reference spelling, not scripture — adapt it freely so it reads like the user wrote it).

These engineering principles are inherited verbatim from Anthropic's [`code-simplifier`](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md) agent. They govern every line you emit:

1. **Preserve functionality.** "Never change what the code does — only how it does it." When you touch the user's existing files, all original features, outputs, and behaviors must survive intact. An integration that breaks their checkout to add a proxy dashboard is a failure, not a feature.
2. **Apply project standards.** Follow the conventions already present in *their* code: ES modules, `function` declarations over arrow functions where the file does, explicit return types, the framework's idiomatic error handling, consistent naming. Match the house style; do not impose this skill's.
3. **Clarity over brevity.** "Explicit code is often better than overly compact code." Reduce nesting, delete redundancy, name things well — but never at the cost of legibility. A reviewer should understand the integration in one read.
4. **No nested ternaries.** "Avoid nested ternary operators — prefer switch statements or if/else chains for multiple conditions." Dense one-liners that hide control flow are a defect, not a flourish.
5. **Don't over-simplify.** Do not create overly clever solutions, combine too many concerns into one function, remove helpful abstractions, or make the code harder to debug or extend. Fewer lines is not the objective; a system the user can maintain after you leave is.
6. **Scope discipline.** "Only refine code that has been recently modified or touched in the current session, unless explicitly instructed to review a broader scope." You are adding a proxy integration — you are not refactoring their auth layer because you happened to read it.

**The philosophical core, stated plainly:** a good integration is one the user forgets was generated. It dissolves into their codebase. It introduces exactly the new capability they asked for and not one accidental dependency, opinion, or stylistic divergence more. Optimize for the second reader — the maintainer six months from now who must extend this without you — over the cleverness of the first write. When the platform contract and the user's preference collide, the contract wins (it's enforced server-side; their preference is not). Everywhere else, defer to their world.

**You are encouraged to customize.** If the user's stack suggests a cleaner shape than the reference samples here — a different state manager, a server framework this skill doesn't show, a billing rail other than Stripe, a component library of their own — build it that way and say so. The samples exist to make the *contract* unambiguous, not to constrain the *craft*. The only hard floor is the security non-negotiables and the key invariants; above that floor, exercise judgment.

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
  countries: ['us', 'gb', 'fr', 'nl', 'pl', 'ge'],
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
import { ProxiesClient } from '@proxies-sx/pool-sdk';
import { auth } from '@/lib/auth'; // your existing auth
import { db } from '@/lib/db';     // your DB (maps userId -> pakKeyId)

export const { GET, POST, DELETE } = createPoolApiHandlers({
  proxies: new ProxiesClient({
    apiKey: process.env.PROXIES_SX_API_KEY!,
    proxyUsername: process.env.PROXIES_SX_USERNAME!,
  }),
  // CRITICAL: scope each request to the logged-in user so customer A
  // can never see customer B's keys. null = handlers return 401.
  getSessionUserId: async () => (await auth())?.user?.id ?? null,
  // Which pak_ belongs to this user? null = 404 no_key.
  getUserKeyId: async (userId) => (await db.customers.get(userId))?.pakKeyId ?? null,
});
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

// All hooks take the mounted API route as a positional string and return
// { data, loading, error, refetch }.
const me = usePoolKey('/api/pool');       // me.data.pakKey, me.data.proxyUsername, me.data.usage
const stock = usePoolStock('/api/pool');  // polls every 30s; pass { refreshIntervalMs } to override
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
  pool: 'peer',       // the flagship network — widest country reach
  country: 'us',
  sid: customerId,    // session name — REQUIRED for stickiness to persist
  rotation: 'sticky', // without this, the gateway default auto10 rotates ~every 10 min
});
// → "http://psx_abc-peer-us-sid-cust_7a3f9b-rot-sticky:pak_xyz@gw.proxies.sx:7000"
//
// IMPORTANT: sticky pins the DEVICE, not the IP. Mobile carriers can re-NAT a
// held modem's egress IP — the gateway compensates by weighting IP-stability,
// and `strict: true` adds a hard stability floor on top. Residential peers hold
// addresses for hours-to-days. If the workflow needs a guaranteed exclusive
// device (cf_clearance, banking), use a Reserved IP — docs/RESERVED-IPS.md.
// Full token reference: docs/USERNAME-DSL.md
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

> **Complete reference: [`docs/USERNAME-DSL.md`](./docs/USERNAME-DSL.md).** It
> documents all fifteen tokens, which are hard vs soft filters, and — most
> importantly — **what each one does when nothing matches**. Several tokens
> silently widen instead of erroring, so a filter can look honoured when it is
> not. Read it before you build a picker UI or debug a "the filter is ignored"
> report. The summary below is the working subset.

The customer's HTTP/SOCKS5 client connects to:
```
{protocol}://{username}:{pakKey}@gw.proxies.sx:{port}
```

| Field | Value |
|---|---|
| `protocol` | `http` or `socks5` |
| `port` | `7000` for HTTP, `7001` for SOCKS5 |
| `username` | `psx_RESELLER_USERNAME` + optional `-`-separated tokens |
| `pakKey` | The `pak_*` secret minted via the API — this is the **password** |

**The `pak_` is the password, never the username.** The gateway resolves the
account from the username only (`proxyUsername`, then `psx_<userId>`, then
e-mail); no code path resolves a `pak_…` username, so `pak_xxx-mbl-us` as a
username fails auth. Use `buildProxyUrl(proxyUsername, pakKey, opts)`.

**Tokens inside the username** (all optional, in any order, separated by `-`):

| Token | Example | Meaning · what happens when nothing matches |
|---|---|---|
| Pool | `peer`, `mbl`, `any` | `peer` = **the flagship network** (~82–120 countries, mixed mobile + residential). `mbl` = our carrier modems, **exactly 6 countries: US GB FR NL PL GE**. `any`/`best` = no pool filter. |
| Country | `us`, `gb`, `fr`, `nl`, `pl`, `ge` | ISO alpha-2. Those 6 are the `mbl` set; `peer` spans far more. **`ge` is GEORGIA** — Germany is `de` and has **no `mbl` stock** (`mbl-de` always fails; use `peer-de`). An unrecognised country silently becomes `any` (global). |
| `sid-{id}` | `sid-cust_8f3a21bd` | Session name. 1–64 chars `[a-z0-9_]`, no `-`. **Required for `sticky`/`auto*` to persist across connections** — without it every connection starts a fresh synthetic session. **A sid alone is NOT sticky**: with no `-rot-`, the default `auto10` still rotates it. The token is `sid`, not `session` — `-session-<id>` is silently skipped. |
| `rot-{mode}` | `rot-sticky`, `rot-auto5` | `sticky`/`hard` pin the **device** (`hard` ≡ `sticky`, **not** a new IP per request). `auto5/10/20/60` re-pick every N min. `ondemand` re-picks per connection. **Omitting `-rot-` applies the gateway default `auto10`** (~10 min) — it is not "no rotation". Unrecognised value → `auto10`, silently. |
| `strict` | `rot-sticky-strict` | **Bare flag, no value.** Only active with `sticky`/`hard`: adds a hard IP-stability floor and heavier stability weighting. No-op elsewhere. |
| `carrier-{name}` | `carrier-att` | **Soft.** If no endpoint matches, the gateway **retries without it and serves a different carrier as a normal 200.** Make it binding with `failover-samecarrier` or `failover-strict`. |
| `city-{name}` | `city-nyc` | **Soft — ranking bonus only**, it never excludes anyone. No match → any city in the country, silently. Prefer carrier/isp/asn for real precision. |
| `iptype-{class}` | `iptype-residential` | **Hard** IP-class filter. No match → `E_NO_STOCK_COUNTRY` 502. |
| `isp-{slug}` | `isp-spectrum` | **Hard** slugified match (peer pool). No match → 502. |
| `asn-{number}` | `asn-7018` | **Hard** exact ASN match. No match → 502. Most precise carrier filter. |
| `failover-{policy}` | `failover-strict` | `any` / `samecountry` (default) / `samecarrier` / `samenode` / `strict`. `strict` disables substitution and fails clean. |
| `ttl-{seconds}` | `ttl-43200` | Session-row TTL, clamped 60 – 2,592,000 (default 3600). NOT an IP-hold guarantee, and **immutable for a live sid** — changing it does nothing until that row expires; use a new sid. |
| `pin-{type}-{id}` | `pin-lease-l23d4e83c5b` | Pin one endpoint. Types: `lease` (Reserved IPs — survives rotation), `device`, `port`. **An unknown type is silently dropped** and the request falls through to shared selection. |

**Example URL:**
```
http://psx_acme-peer-us-sid-customer123-rot-sticky:pak_a1b2c3@gw.proxies.sx:7000
```

Route customer123 through the US peer network and hold one device for the
session. Two things to tell the customer, both correct-by-design:

1. **Sticky pins the DEVICE, not the IP.** Mobile CGNAT can still re-NAT a held
   modem's exit address. Residential peers hold addresses far longer, which is
   why `peer` + `sticky` is the recommended pairing for IP-hold work. For a
   guaranteed exclusive device, use a **Reserved IP** —
   [`docs/RESERVED-IPS.md`](./docs/RESERVED-IPS.md).
2. **`sticky` needs the `-sid-`.** Both tokens, every time.

Full explanation: [wiki page Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation).

The SDK's `buildProxyUrl(pakKey, opts)` generates this. In other languages,
build the string manually — note both tokens are needed for stickiness:

```python
def build_proxy_url(reseller, pak_key, country='us', pool='peer',
                    sid=None, rotation='sticky'):
    parts = [reseller, pool, country]
    if sid:
        parts += ['sid', sid]          # session name — [a-z0-9_], no hyphens
    if rotation:
        parts += ['rot', rotation]     # omit and you get the gateway default, auto10
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
2. **Scope every request** by the authenticated customer. In the React PATH B example, `getSessionUserId` MUST read the session and `getUserKeyId` MUST map that user to their own `pakKeyId` — without them, customer A can read/regenerate customer B's keys.
   - ✅ **Session routes are scoped per-customer since 0.6.0** (npm now serves 0.9.0): `createPoolApiHandlers()`'s `/my-sessions` GET + DELETE routes thread the caller's `pakId` via `getUserKeyId` → `sessions.list({ pakId })` / `close(key, { pakId })`, and `ActiveSession` carries `pakKeyId`. ⚠️ Only if you are pinned to the legacy `0.5.x` packages: those routes were NOT scoped (any signed-in customer could list/close other customers' sessions) — upgrade (`npm i @proxies-sx/pool-portal-react@latest`) rather than exposing them. Confirm with `npm view @proxies-sx/pool-portal-react version`.
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

Prefer the atomic `topUp()` over a read-modify-write `update()` — it `$inc`s the cap and extends expiry in a single server-side write, immune to the race where two concurrent renewals clobber each other:

```ts
await proxies.poolKeys.topUp(customer.pakKeyId, {
  addTrafficGB: additionalGB,
  extendDays: 30,
  idempotencyKey: stripeEvent.id,
});
// If the key auto-suspended at its old cap, top-up does NOT re-enable it —
// flip it back explicitly (see Auto-Suspend section above):
await proxies.poolKeys.update(customer.pakKeyId, { enabled: true });
```

### Customer is an AI agent → accept USDC via x402 (instead of, or alongside, Stripe)

If the buyer is an autonomous agent rather than a human with a card, you can sell proxies on the same rail the agent economy already speaks: **HTTP 402 + USDC on-chain**. The agent calls your endpoint, gets `402 Payment Required` with *your* wallet address, pays on Base or Solana, retries with the transaction hash, and you mint a `pak_` capped at exactly what they paid for. You keep the margin between your retail USDC price and the platform's wholesale rate — the same economics as Stripe, on a different rail, with no chargebacks and second-scale settlement.

The shape, in one breath: **verify the on-chain payment with the public facilitator → mint a `pak_` whose `idempotencyKey` is the transaction hash (so retries never double-mint) → return the proxy URL.** You run no chain node and no payment infrastructure.

```ts
// Sketch — the full ~80-line drop-in handler is in docs/X402-RESELLER-INTEGRATION.md
const verify = await fetch('https://x402.org/facilitator/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signature: txHash }),
}).then((r) => r.json());

if (!verify.valid) return Response.json({ error: 'unverified' }, { status: 402 });

const key = await proxies.poolKeys.create({
  label: `x402:${verify.payer}:${txHash.slice(0, 10)}`,
  trafficCapGB: gbPaidFor,
  expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  idempotencyKey: txHash, // the tx hash IS the natural dedupe key
});
return Response.json({ proxyUrl: proxies.buildProxyUrl(key.key, { country, rotation: 'sticky' }) });
```

**Full code + flow diagram + security model:** [`docs/X402-RESELLER-INTEGRATION.md`](./docs/X402-RESELLER-INTEGRATION.md). **Operational wallet setup** (creating Base + Solana wallets, env config, end-to-end test, treasury hygiene): the [x402 and Wallet Setup wiki page](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/x402-and-Wallet-Setup). This is the canonical pattern — there is no `@proxies-sx/pool-portal-x402` package yet (a `createX402PaidProxyHandler()` factory is earmarked for 0.7.x); until then, the copy-paste handler in the doc IS the implementation.

---

## Pricing (do NOT pin numbers in code or docs)

Wholesale rates from Proxies.sx have volume tiers. Do not hardcode dollar amounts in the user's app — they are configured by the platform and can change.

For larger resellers, wholesale and volume pricing is negotiable with the Proxies.sx team. The published $4/GB base and volume tiers are the self-serve floor, not a ceiling on the discount. If the user plans meaningful volume, tell them to contact admin at client.proxies.sx to arrange a custom wholesale rate.

To get current rates programmatically:
- `GET https://api.proxies.sx/v1/x402/pricing` (public, no auth)
- Or check the user's [client.proxies.sx](https://client.proxies.sx) dashboard

The user sets their **retail** price (whatever they charge their own customers) — that lives in their own app config (`apps/starter/src/config.ts` in the starter, or wherever they put it). Our wholesale price affects their margin, not their pricing UI.

---

## Reference files (deeper detail)

When the user needs more than this skill provides, point them to the right file in the repo:

| File | When to read |
|---|---|
| **`docs/USERNAME-DSL.md`** | **The complete token reference — all 15 tokens, hard vs soft, and what each does when nothing matches. Read before building any picker UI or debugging routing.** |
| `docs/RESERVED-IPS.md` | Exclusively leased devices (`-pin-lease-`) — lifecycle, the offline-substitution caveat, how to resell it |
| `docs/PRIVATE-POOL.md` | Reserved / committed capacity as a premium tier, quote flow, honesty rules |
| `docs/MIGRATION-DSL-COMPLETENESS.md` | Upgrading an existing integration: `strict`, `pin.type: 'lease'`, the new `pin.id` throw, and every doc correction |
| `README.md` | Marketing-friendly overview, FAQ, license |
| `packages/sdk/README.md` | Full SDK API surface, all methods, error types, language-by-language REST examples |
| `packages/react/README.md` | `<PoolPortal />` props, all hooks, server handler details, theming |
| `apps/starter/README.md` | Full Next.js storefront deployment guide |
| `apps/starter/CLAUDE.md` | Per-task instructions for AI agents customizing the starter (change brand, add country, add admin page, change DB schema) |
| `CLAUDE.md` | Repo-wide architecture + invariants for AI agents working ON the SDK code itself |
| `docs/X402-RESELLER-INTEGRATION.md` | Accept USDC from AI agents — full drop-in handler, flow diagram, reseller economics |
| `docs/TWO-SIDED-DASHBOARD.md` | Admin-side vs customer-side architecture, with a Coronium-style reference |
| `SECURITY.md` | Production hardening checklist |

**Wiki** ([github.com/bolivian-peru/proxy-reseller-kit/wiki](https://github.com/bolivian-peru/proxy-reseller-kit/wiki)) — operational and conceptual depth that doesn't live in the code. Point the user (or read yourself) when the question is *operational* or *conceptual* rather than *API-shaped*:

| Wiki page | When to read |
|---|---|
| [Getting Started](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Getting-Started) | First-time onboarding: signup → reseller upgrade → first `psx_` key → first customer |
| [Integration Paths](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Integration-Paths) | Long-form A/B/C/D decision tree with per-language worked examples |
| [Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation) | **Before answering any "the IP keeps changing" question** — gateway sticky (Layer 1) vs carrier CGNAT (Layer 2), cf_clearance failure mode, dedicated-port escape hatch |
| [Pak Key Lifecycle](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Pak-Key-Lifecycle) | Full mint → use → top-up → rotate → suspend → revoke state machine + audit log |
| [x402 and Wallet Setup](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/x402-and-Wallet-Setup) | Operational USDC setup — wallets, env config, end-to-end test, treasury hygiene |
| [Troubleshooting](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Troubleshooting) | Flat error catalog: reseller API + every gateway `E_*` code + Stripe/x402 webhook debugging |
| [Glossary](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Glossary) | Precise one-line definitions of every term + acronym |

---

## Quick smoke test (run before reporting "done" to the user)

After generating code, **prove** the integration routes. Types compile against a
username that never authenticates; only a real request rules that out. The one
command that matters:

```bash
curl -x "http://<username>:<pak>@gw.proxies.sx:7000" https://api.ipify.org
```

Full round trip:

```bash
# 1. Mint a real key (replace YOUR_KEY with the user's real psx_ key)
RESPONSE=$(curl -s -X POST https://api.proxies.sx/v1/reseller/pool-keys \
  -H "X-API-Key: psx_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"label":"smoke-test","trafficCapGB":1}')
PAK=$(echo "$RESPONSE" | grep -oE 'pak_[a-z0-9]+' | head -1)
KEY_ID=$(echo "$RESPONSE" | grep -oE '"id":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "Got key: $PAK"

# 2. Route through the gateway. USERNAME = the user's psx_ reseller username.
#    The pak is the PASSWORD — never the username.
curl -x "http://USERNAME-peer-us:$PAK@gw.proxies.sx:7000" https://api.ipify.org
# → a bare US IP. That proves auth + parse + selection + egress all work.

# 3. Prove the generated sticky string actually holds a device
for i in 1 2 3; do
  curl -s -x "http://USERNAME-peer-us-sid-smoke_test1-rot-sticky:$PAK@gw.proxies.sx:7000" \
    https://api.ipify.org; echo
done

# 4. SOCKS5 on 7001 takes the identical username
curl -x "socks5://USERNAME-peer-us:$PAK@gw.proxies.sx:7001" https://api.ipify.org

# 5. Clean up
curl -s -X DELETE "https://api.proxies.sx/v1/reseller/pool-keys/$KEY_ID" \
  -H "X-API-Key: psx_YOUR_KEY"
```

If step 2 returns a real IP through the proxy, the integration works.

**Reading step 3 correctly:** you are verifying the *device* is held, not the
address. Mobile CGNAT can re-NAT a held modem, so differing IPs there is not
necessarily a bug — see
[`docs/USERNAME-DSL.md`](./docs/USERNAME-DSL.md#the-two-things-that-surprise-customers).
If a country returns `E_NO_STOCK_COUNTRY`, check live stock before blaming the
code: `curl -s https://api.proxies.sx/v1/gateway/pool/availability` (counts per
country, never IPs).

---

## Final checklist before handing off

- [ ] User has a `psx_*` API key from `client.proxies.sx/account`
- [ ] The key is in a server-side env var, never in client code
- [ ] If using PATH B/C, the API route scopes by authenticated user
- [ ] Stripe webhook signature is verified (if using Stripe)
- [ ] User can mint a `pak_*`, build a proxy URL, and route real traffic through it
- [ ] User knows how to regenerate a leaked `pak_*`
- [ ] No specific pricing numbers were hardcoded — UI either reads `/v1/x402/pricing` or shows the user's own retail tiers
