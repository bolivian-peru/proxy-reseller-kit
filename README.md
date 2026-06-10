<div align="center">

# proxy-reseller-kit

**Open-source reseller toolkit for the Proxies.sx Pool Gateway.**
**Ship a branded mobile-proxy business in an afternoon — or embed mobile proxies into any app, in any language.**

[![npm: pool-sdk](https://img.shields.io/npm/v/@proxies-sx/pool-sdk?label=%40proxies-sx%2Fpool-sdk)](https://www.npmjs.com/package/@proxies-sx/pool-sdk)
[![npm: pool-portal-react](https://img.shields.io/npm/v/@proxies-sx/pool-portal-react?label=%40proxies-sx%2Fpool-portal-react)](https://www.npmjs.com/package/@proxies-sx/pool-portal-react)
[![CI](https://github.com/bolivian-peru/proxy-reseller-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/bolivian-peru/proxy-reseller-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)

[**Skill (AI agents)**](#for-ai-agents-and-code-builders) · [**Pick a path**](#pick-an-integration-path) · [**Quickstart**](#quickstart) · [**Architecture**](#architecture) · [**Deploy**](#deploy) · [**📖 Wiki**](https://github.com/bolivian-peru/proxy-reseller-kit/wiki)

</div>

---

## 📖 Wiki — operational and conceptual docs

Long-form docs that don't belong inline with code live in the **[wiki](https://github.com/bolivian-peru/proxy-reseller-kit/wiki)**:

- [Getting Started](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Getting-Started) — full onboarding from zero
- [Integration Paths](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Integration-Paths) — A/B/C/D decision tree
- [Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation) ⭐ — what "sticky" actually guarantees on mobile carriers
- [Pak Key Lifecycle](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Pak-Key-Lifecycle) — mint, top-up, rotate, revoke
- [x402 and Wallet Setup](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/x402-and-Wallet-Setup) — accept USDC from AI agents
- [Troubleshooting](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Troubleshooting) — flat error catalog
- [Glossary](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Glossary) — every term defined

---

## For AI agents and code builders

If you're an AI assistant (Claude / Cursor / Copilot / etc.) or any tool integrating this into a user's app, **read [`SKILL.md`](./SKILL.md) first**. It contains:

- Decision tree for picking the right integration path (4 paths)
- Per-language code patterns (TypeScript, PHP, Python, Go, Ruby + curl)
- The proxy URL token DSL grammar
- Security non-negotiables for production
- A smoke-test checklist to verify the integration before reporting "done"

`SKILL.md` follows the [Anthropic skill format](https://github.com/anthropics/skills) and is designed to load into any AI coding tool's context.

For human-readable depth: [`packages/sdk/README.md`](./packages/sdk/README.md), [`packages/react/README.md`](./packages/react/README.md), [`apps/starter/README.md`](./apps/starter/README.md).

---

## Why

Traditional proxy resale means buying modem hardware, juggling SIM plans, running a farm, and wiring in a developer. Every price hike from your supplier eats your margin.

The [Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy) takes care of the infrastructure — you get a single endpoint (`gw.proxies.sx:7000`), wholesale pricing with volume tiers, and a per-customer sub-key system (`pak_*`). Live pricing: see [client.proxies.sx](https://client.proxies.sx) or [api.proxies.sx/v1/x402/pricing](https://api.proxies.sx/v1/x402/pricing).

This repo takes care of the **software** — SDK, drop-in React component, full Next.js storefront, and a language-agnostic REST API. Zero paid dependencies beyond what you choose (SMTP provider, hosting).

---

## Two device networks, one gateway

The same gateway endpoint (`gw.proxies.sx:7000` HTTP / `:7001` SOCKS5) routes through either of two device networks — your customer chooses by a token in their proxy username. Same credentials, same DSL, same `$4/GB` — only the device pool differs.

| Token | Network | Status | Best for |
|---|---|---|---|
| **`-mbl-`** | **Mobile** (our own fleet of stable 4G/5G mobile-carrier devices) | **Production · recommended** | Workloads that need consistent speed and uptime. Monitored quality, predictable throughput. The default we suggest customers start on. |
| **`-peer-`** | **Residential** (real home- and mobile-ISP connections from our community network) | **Growing — fleet expanding daily** | High-volume tasks where residential IPs improve success rate on consumer-facing sites that profile mobile vs residential differently. |
| **`-any-`** | Auto-pick | — | Prefers mobile; falls back to residential when mobile is fully utilized in the requested country. |

Example proxy URLs (same `pak_` everywhere — only the token changes):

```bash
# Mobile (default, production)
curl -x http://psx_xxx-mbl-us:pak_xxx@gw.proxies.sx:7000 https://api.ipify.org

# Residential (growing community network)
curl -x http://psx_xxx-peer-us:pak_xxx@gw.proxies.sx:7000 https://api.ipify.org

# Auto-pick — prefer mobile, fall back to residential
curl -x http://psx_xxx-any-us:pak_xxx@gw.proxies.sx:7000 https://api.ipify.org
```

The reseller kit exposes the pool toggle in `<PoolSessionSpawner>` and `<PoolDocsPanel>`; if you build your own UI, just include the token when constructing the username via `buildProxyUrl` / `buildProxyString` (see `@proxies-sx/pool-sdk`).

**Which pool for sticky-IP workflows?** Sticky pins the **modem**, not the IP — mobile carriers can rotate egress IPs via CGNAT even on a held modem (the gateway smart-picks the most IP-stable modem available, but the carrier always has the final say). For workflows that need a TRULY immutable IP (cf_clearance, banking, mTLS bound to source IP), use `-peer-` — residential ISPs hold IPs hours-to-days. Full Layer-1-vs-Layer-2 explanation in the wiki: [Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation).

**Reliability — auto-failover is built in (nothing for you or your customers to handle).** The gateway runs connect-phase auto-failover: if the modem it selects has dropped, that modem is demoted from the pool and a healthy one is retried *before any response is returned* — this is what prevents the occasional `503 / temporarily unavailable`. Your customer controls how wide the replacement may be with the `-failover-` token (`samecountry` default, `samecarrier`, `samenode`, `any`, or `strict` to disable substitution and fail clean). SOCKS5 (`:7001`) additionally falls back to a modem's HTTP CONNECT path (`:7000`) if its SOCKS service is briefly down, so **both ports are equally reliable** — pick whichever your customer's tooling prefers.

---

## Two-sided dashboard pattern (recommended for SaaS resellers)

Most production resellers ship **TWO dashboards**, not one:

- **Reseller Admin Panel** (e.g. `admin.brand.com`) — for your operators/staff. Manage tariffs, customers, top-ups, custom per-customer rates, audit logs. Built on your existing admin framework. Doesn't use the React components below.
- **Customer Dashboard** (e.g. `dashboard.brand.com`) — for your end-customers. They see their own pak_ key, spawn proxy URLs, manage own sessions, top up. Built with `@proxies-sx/pool-portal-react`'s drop-in components.

Both share a **single backend layer** with one `ProxiesClient` instance (server-side, holds your `psx_` API key). Admin routes call SDK methods directly; customer routes go through `createPoolApiHandlers()`, which scopes `/me` and `/regenerate` to the caller via `getUserKeyId`.

> ⚠️ **Multi-tenant note (published 0.5.x):** the `/my-sessions` routes from `createPoolApiHandlers()` are **not** per-customer scoped yet — on a multi-tenant customer dashboard you must lock them down at your route layer until `0.6.x` is published. See [`packages/react/README.md`](./packages/react/README.md) → "Session routes — multi-tenant security" and `RESELLER-UPDATE-PROMPT`.

Why two: different audiences, different authz domains, different scale concerns, **catastrophically different failure modes** if you mix them (admin bug = regression; customer bug exposing other customers = P0 data leak).

**Full pattern with concrete examples and a Coronium-style reference architecture: [`docs/TWO-SIDED-DASHBOARD.md`](./docs/TWO-SIDED-DASHBOARD.md).**

---

## Pick an integration path

Match your stack to a path. The integration differs significantly between them — don't mix.

| If you... | Use | Effort |
|---|---|---|
| Want a **branded reseller storefront**, starting fresh | **PATH A** — Clone [`apps/starter/`](./apps/starter) (Next.js + Auth.js + Stripe + Postgres) | ~10 min |
| Already have a **React/Next.js app** and want a drop-in dashboard | **PATH B** — `<PoolPortal />` component | ~15 min |
| Have a **non-React JS app** (Express, Fastify, Hono, Vue+API, plain Node, Bun, Deno, Workers) | **PATH C** — SDK only | ~10 min |
| Backend is **PHP / Python / Go / Ruby / Rust / Elixir** (anything not JS) | **PATH D** — REST API directly | ~5 min |

Full decision tree + step-by-step for each path lives in [`SKILL.md`](./SKILL.md).

---

## Packages

```
proxy-reseller-kit/
├── packages/
│   ├── sdk/         → @proxies-sx/pool-sdk           Typed API client (npm)
│   └── react/       → @proxies-sx/pool-portal-react  Drop-in UI + server handlers (npm)
├── apps/
│   └── starter/     → Full Next.js storefront template
├── SKILL.md         → AI-agent integration guide (Anthropic skill format)
└── CLAUDE.md        → Repo invariants for agents working ON the SDK code
```

| Package | npm | What it's for |
|---------|-----|---------------|
| [`@proxies-sx/pool-sdk`](./packages/sdk) | [![npm](https://img.shields.io/npm/v/@proxies-sx/pool-sdk)](https://www.npmjs.com/package/@proxies-sx/pool-sdk) | Mint Pool Access Keys, build proxy URLs, fetch usage. Zero runtime deps. Works in Node, Bun, Deno, Edge Workers. |
| [`@proxies-sx/pool-portal-react`](./packages/react) | [![npm](https://img.shields.io/npm/v/@proxies-sx/pool-portal-react)](https://www.npmjs.com/package/@proxies-sx/pool-portal-react) | `<PoolPortal />` component + headless hooks + `createPoolApiHandlers()` Next.js route factory. |
| [`apps/starter`](./apps/starter) | (template) | Complete Next.js App Router storefront — landing, pricing, magic-link login, Stripe checkout, self-hosted Postgres. Under 1,000 LOC including comments. |

Non-JS users: skip the npm packages and call the REST API directly. See [`SKILL.md` — PATH D](./SKILL.md#path-d--direct-rest-api-php--python--go--ruby--any-language).

---

## Show your customers HOW to use their pak (recommended)

Customers who get a `pak_` and a password but don't know the username format
(`pak_xxx-mbl-COUNTRY`) just 407 once and give up. **Conversion problem #1.**

Three ways to fix it (pick one or stack them):

**1. Drop in `<PakQuickstart>`** — React component, prefilled with the customer's actual credentials:

```tsx
import { PakQuickstart } from '@proxies-sx/pool-portal-react';
import '@proxies-sx/pool-portal-react/styles.css';

<PakQuickstart
  pak={pak.key}
  secret={pakSecret}        // optional; defaults to placeholder
  capGB={pak.trafficCapGB}
  usedGB={pak.trafficUsedMB / 1024}
/>
```

Renders: 30-second curl, country picker, sticky-session toggle, copy buttons,
SOCKS5 + Python + Node + Playwright snippets, troubleshooting table.
~80 lines tall, drops in next to wherever you display the pak.

**2. Link to the hosted explainer** — for portals not built in React:
```
https://agents.proxies.sx/pool-quickstart.html?pak=pak_xxx&pw=YOUR_PASSWORD
```
The page reads `pak` and `pw` from the URL and prefills the curl. Iframe it,
linked-button it, or paste the URL into a welcome email.

**3. Email it on mint** — when you mint a pak, send the customer an email with
the credentials AND a link to the quickstart. Even a single line — *"Here's
your pak. Use it like this: `curl -x http://pak_xxx-mbl-us:PW@gw.proxies.sx:7000 https://api.ipify.org`. Full quickstart: https://agents.proxies.sx/pool-quickstart.html"* — converts ~3× better than no email.

---

## Accept USDC from AI agents (x402)

If your customers include autonomous AI agents — Claude, GPT, browser-using
agents, scrapers run by other agents — you can sell them proxies the way
the rest of the agent economy already pays for things: **HTTP 402 + USDC**.

The flow is the same one [agents.proxies.sx](https://agents.proxies.sx) uses today:

1. Agent calls your endpoint with no payment.
2. You return `402 Payment Required` with your USDC wallet + price.
3. Agent pays on-chain (Base ~2s, Solana ~400ms) and retries with the tx hash.
4. You verify via the **public Coinbase facilitator** (no node needed, no
   chain infra), mint a `pak_` capped at exactly what they paid for, return it.

That's ~80 lines of route handler — full drop-in (Next.js App Router),
economics, and security model in **[`docs/X402-RESELLER-INTEGRATION.md`](./docs/X402-RESELLER-INTEGRATION.md)**.

You keep the margin between what you charge the agent (USDC) and what
the platform charges you ($4/GB) — same wholesale economics as your
Stripe storefront, on a different rail.

---

## Quickstart

> **📦 Current version: 0.7.0 — install from the GitHub release.**
> The npm registry currently serves the older `0.5.x`. The current **0.7.0**
> build (adds the `sticky-strict` rotation mode + corrects `hard` semantics —
> `hard` pins like sticky, NOT "new IP per request" — and teaches the `-sid-`
> requirement, on top of 0.6.x per-customer session scoping + white-label) is
> distributed as self-contained release tarballs. Installing the React package
> pulls the SDK automatically:
> ```bash
> # Full kit (React components + SDK):
> npm i https://github.com/bolivian-peru/proxy-reseller-kit/releases/download/v0.7.0/proxies-sx-pool-portal-react-0.7.0.tgz
> # SDK only:
> npm i https://github.com/bolivian-peru/proxy-reseller-kit/releases/download/v0.7.0/proxies-sx-pool-sdk-0.7.0.tgz
> ```
> The plain `npm install @proxies-sx/...` commands below install `0.5.x` until
> 0.7.0 is published to npm. See [Releases](https://github.com/bolivian-peru/proxy-reseller-kit/releases/tag/v0.7.0).

### Deploy a full storefront in 10 minutes

```bash
git clone https://github.com/bolivian-peru/proxy-reseller-kit.git my-shop
cd my-shop/apps/starter
cp .env.example .env         # fill in PROXIES_SX_*, STRIPE_*, AUTH_SECRET
pnpm install
docker compose up -d db      # starts Postgres on :5432
pnpm db:migrate               # creates all tables
pnpm dev                      # → http://localhost:3000
```

In another terminal:
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Visit `http://localhost:3000`, click **Sign in** (the magic link prints to the server console in dev — no SMTP needed), click **Buy**, pay with test card `4242 4242 4242 4242`. The webhook mints your `pak_` key and the dashboard shows your live proxy URL.

### Embed the dashboard in an existing app

```bash
npm install @proxies-sx/pool-portal-react @proxies-sx/pool-sdk
```

```tsx
import { PoolPortal } from '@proxies-sx/pool-portal-react';
import '@proxies-sx/pool-portal-react/styles.css';

<PoolPortal apiRoute="/api/pool" branding={{ name: 'AcmeProxies' }} />
```

Plus one API route (`app/api/pool/[...path]/route.ts`) — see the [React package README](./packages/react/README.md).

### Just the SDK

```bash
npm install @proxies-sx/pool-sdk
```

```ts
import { ProxiesClient } from '@proxies-sx/pool-sdk';

const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY!,
  proxyUsername: process.env.PROXIES_SX_USERNAME!,
});

// Optional: ship a 60-day "use it or lose it" credit
const key = await proxies.poolKeys.create({
  label: 'alice',
  trafficCapGB: 10,
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
});
const url = proxies.buildProxyUrl(key.key, { country: 'us', rotation: 'sticky' });
```

Details: [SDK README](./packages/sdk/README.md). Time-bounded credits via `expiresAt` are documented in [SKILL.md](./SKILL.md#time-bounded-credits-with-expiresat-v020).

### Not on JavaScript? You can still integrate

The SDK is a thin wrapper around a public REST API. **Any language with an HTTP client works** — PHP, Python, Ruby, Go, Rust, Elixir, even bash + curl.

```bash
# Mint a pak_ key for a customer (with optional 60-day expiry)
curl -X POST https://api.proxies.sx/v1/reseller/pool-keys \
  -H "X-API-Key: psx_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "customer:alice",
    "trafficCapGB": 10,
    "expiresAt": "2026-08-30T00:00:00Z"
  }'

# → { "id": "...", "key": "pak_...", "trafficCapGB": 10,
#     "expiresAt": "2026-08-30T00:00:00.000Z", "isExpired": false, ... }
```

The proxy URL is just plain HTTP Basic auth — works with any HTTP/SOCKS5 client in any language:

```
http://psx_RESELLER-mbl-us-sid-alice_session1-rot-sticky:pak_CUSTOMER_KEY@gw.proxies.sx:7000
```

Endpoints (`X-API-Key` auth, [`psx_` keys minted at client.proxies.sx/account](https://client.proxies.sx/account)):

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/reseller/pool-keys` | Mint key. Accepts `Idempotency-Key` header (v0.3.0+) |
| `GET` | `/v1/reseller/pool-keys` | List keys + usage |
| `GET` | `/v1/reseller/pool-keys/:id` | Fetch single key (v0.3.0+) |
| `PATCH` | `/v1/reseller/pool-keys/:id` | Update label / cap / enabled / expiresAt |
| `POST` | `/v1/reseller/pool-keys/:id/topup` | Atomic cap+expiry extension (v0.3.0+) |
| `POST` | `/v1/reseller/pool-keys/:id/regenerate` | Rotate secret. Returns full record from v0.3.0 |
| `DELETE` | `/v1/reseller/pool-keys/:id` | Delete |

Full spec: [api.proxies.sx/docs/api](https://api.proxies.sx/docs/api) (Swagger UI) | [api.proxies.sx/docs/api-json](https://api.proxies.sx/docs/api-json) (OpenAPI 3.0)

**v0.3.0 production-readiness features:**
- `Idempotency-Key` header on writes — dedupes retries within 24h. Critical for webhook handlers and payment flows.
- `X-Request-ID` returned on every response — paste in support tickets to skip log-grepping.
- `POST /:id/topup` — atomic single-write that does cap `$inc` and extends `expiresAt = max(now, current) + days`.
- SDK adds built-in retry (3 attempts, exp + jitter, honors `Retry-After`). Disable with `retry: false`.

Migration guide for existing v0.2.0 integrations: [docs/MIGRATION-0.3.0.md](./docs/MIGRATION-0.3.0.md).

Per-language examples (Python, PHP, Go, Ruby): see [SDK README](./packages/sdk/README.md#not-using-javascript-call-the-rest-api-directly).

---

## Architecture

```
Your customer's browser                        Proxies.sx
       │                                           │
       │  1. HTTPS to your storefront              │
       ▼                                           │
┌──────────────────────┐                           │
│  Next.js app         │                           │
│  (yourdomain.com)    │                           │
│                      │                           │
│  /login              ← NextAuth magic link       │
│  /dashboard          ← <PoolPortal />            │
│  /api/stripe/*       ← Checkout + webhook        │
│  /api/pool/*         ───── ProxiesClient ────────┼─▶ api.proxies.sx
└───────┬──────────────┘                           │   /v1/reseller/pool-keys
        │                                          │
        ▼                                          │
┌──────────────────────┐                           │
│  Postgres            │                           │
│  users, sessions,    │                           │
│  customers,          │                           │
│  purchases,          │                           │
│  webhook_events,     │                           │
│  audit_log           │                           │
└──────────────────────┘                           │
                                                   │
       Customer's proxy traffic (CONNECT/SOCKS5)   │
       ──────────────────────────────────────────▶ gw.proxies.sx:7000
       with pak_ key in proxy Basic-Auth           :7001
```

**Key trust boundary:** your `PROXIES_SX_API_KEY` lives only on *your* server. The browser never sees it.

---

## Customizing

### What most resellers change

Everything a reseller typically wants to change lives in **one file**: [`apps/starter/src/config.ts`](./apps/starter/src/config.ts).

```ts
export const config = {
  brand: {
    name: 'AcmeProxies',
    tagline: 'Enterprise-grade mobile proxies',
    supportEmail: 'hello@acme.example',
    primaryColor: '#7c3aed',
    accentColor: '#10b981',
    logoUrl: '/logo.svg',
  },
  pricing: [
    { id: 'starter', displayName: 'Starter', gb: 5,   priceUsd: 35 },
    { id: 'pro',     displayName: 'Pro',     gb: 25,  priceUsd: 150 },
    { id: 'scale',   displayName: 'Scale',   gb: 100, priceUsd: 500 },
  ],
  countries: ['us', 'de', 'pl', 'fr', 'es', 'gb'],
  primaryCta: 'Get started',
  legal: { tosUrl: '/terms', privacyUrl: '/privacy' },
};
```

### For AI-agent-assisted customization

Read [`CLAUDE.md`](./CLAUDE.md) at the repo root and [`apps/starter/CLAUDE.md`](./apps/starter/CLAUDE.md). They document every common task (change brand, change pricing, add a country, add an admin page) with file paths and line numbers. An AI agent can execute any of them without grepping the source.

---

## Deploy

### Self-host on a VPS ($5/month+ works)

```bash
git clone <your-fork> pool-portal && cd pool-portal/apps/starter
cp .env.example .env           # fill in production values
docker compose up --build -d   # Postgres + app, auto-migrates
```

Point Caddy / nginx at `localhost:3000` for TLS. Example Caddy config:

```
yourdomain.com {
  reverse_proxy localhost:3000
}
```

Details: [apps/starter/README.md](./apps/starter/README.md).

### Requirements

- Node.js 20+
- pnpm 9+ (`corepack enable`)
- Docker (optional — you can bring your own Postgres)
- Proxies.sx reseller API key (mint at [client.proxies.sx/account](https://client.proxies.sx/account))
- Stripe account (test mode is fine for development)
- Any SMTP provider for production email, or skip it — dev mode logs magic links to the console

---

## Security

This repo takes security seriously. Every release is audited to ensure:

- ✅ **No secrets are ever committed.** Only `.env.example` with placeholders.
- ✅ **SQL is parameterized** — `pg` `$1` placeholders, never string interpolation.
- ✅ **Stripe webhooks verify signatures** — required signature check, never disabled.
- ✅ **Webhook idempotency** via unique `stripe_event_id` in `webhook_events`.
- ✅ **`/me` responses uncacheable** (`Cache-Control: private, no-store`).
- ✅ **API keys stay server-side.** The `proxies` client is never imported in `'use client'` files.
- ✅ **Sessions are database-backed** — not JWTs — so signout is instant.
- ✅ **Dev-mode console logger** means you can test the full auth flow with zero SMTP setup and zero risk of accidentally emailing yourself from production.

If you find a vulnerability, please email `security@proxies.sx` rather than opening a public issue.

---

## Contributing

Contributions are welcome. Please:

1. Open an issue first for non-trivial changes — saves us both time.
2. Match the coding style (strict TypeScript, no `any` unless commented, parameterized SQL, no new dependencies without discussion).
3. Add tests for any new SDK or hook functionality.
4. Update the relevant README + `CLAUDE.md` if behavior changes.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide.

---

## FAQ

**Q: Why NextAuth and not Clerk / Auth0 / Supabase Auth?**
A: NextAuth (Auth.js) is free and runs on your own Postgres. Every other option either costs money per MAU or couples you to a third-party service. Magic-link email is all most reseller businesses need.

**Q: Why raw Postgres and not Prisma / Drizzle?**
A: A `schema.sql` file is readable by anyone who knows SQL. There's no generated client, no migration framework to learn, no hidden magic. The whole data layer is ~30 lines in [`src/lib/db.ts`](./apps/starter/src/lib/db.ts).

**Q: Why Stripe-only?**
A: Stripe is the default rail in `apps/starter/` because it's what most resellers want for human customers. For **AI-agent customers**, you can accept USDC via x402 today — see [`docs/X402-RESELLER-INTEGRATION.md`](./docs/X402-RESELLER-INTEGRATION.md). Both rails run side-by-side in the same app, settling into the same `psx_` account balance.

**Q: Can I use this without being a Proxies.sx reseller?**
A: You need a Proxies.sx reseller API key to mint `pak_` sub-keys. Sign up at [client.proxies.sx](https://client.proxies.sx), upgrade to reseller access (email us), then mint an API key.

**Q: What's my cost structure?**
A: You pay Proxies.sx wholesale (current rates + volume tiers in your [client.proxies.sx](https://client.proxies.sx) dashboard). You set your retail price. Typical markups on resold mobile proxies are 2–5×. Stripe takes 2.9% + 30¢ per transaction on top.

**Q: Can I fork and re-brand without attribution?**
A: Yes — MIT license. Do whatever you want. No attribution required.

---

## License

MIT © 2026 Proxies.sx — see [LICENSE](LICENSE).

---

<div align="center">
<sub>Built by <a href="https://proxies.sx">Proxies.sx</a> · Docs: <a href="https://client.proxies.sx/pool-proxy">client.proxies.sx/pool-proxy</a></sub>
</div>
