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

## 📚 In-repo reference

| Doc | What it answers |
|---|---|
| **[`docs/USERNAME-DSL.md`](./docs/USERNAME-DSL.md)** | **The complete proxy-username grammar — all 15 tokens, hard vs soft, and what each does when nothing matches.** Start here for anything routing-related. |
| [`docs/RESERVED-IPS.md`](./docs/RESERVED-IPS.md) | Exclusively leased devices: lifecycle, the offline-substitution caveat, how to resell it |
| [`docs/PRIVATE-POOL.md`](./docs/PRIVATE-POOL.md) | Reserved / committed capacity as a premium tier |
| [`docs/PRIVATE-POOL-BUILD.md`](./docs/PRIVATE-POOL-BUILD.md) | **Re-create the Private Pool page + system in your own app** — build guide, and exactly which guarantees the gateway enforces vs. which are yours to honour |
| [`docs/MIGRATION-DSL-COMPLETENESS.md`](./docs/MIGRATION-DSL-COMPLETENESS.md) | Upgrading an existing integration + every documentation correction |
| [`docs/TWO-SIDED-DASHBOARD.md`](./docs/TWO-SIDED-DASHBOARD.md) | Admin-side vs customer-side architecture |
| [`docs/X402-RESELLER-INTEGRATION.md`](./docs/X402-RESELLER-INTEGRATION.md) | Accept USDC from AI agents |

---

## 📖 Wiki — operational and conceptual docs

Long-form docs that don't belong inline with code live in the **[wiki](https://github.com/bolivian-peru/proxy-reseller-kit/wiki)**:

- [Getting Started](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Getting-Started) — full onboarding from zero
- [Integration Paths](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Integration-Paths) — A/B/C/D decision tree
- [Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation) ⭐ — what "sticky" actually guarantees on mobile carriers
- [Pak Key Lifecycle](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Pak-Key-Lifecycle) — mint, top-up, rotate, revoke
- [Private Pool](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Private-Pool) — reserve dedicated modem or committed peer capacity (quote-based)
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

Wholesale rates carry automatic volume discounts down to $2.40/GB at 250 GB+, and for high-volume resellers, custom wholesale pricing is negotiable directly with admin.

This repo takes care of the **software** — SDK, drop-in React component, full Next.js storefront, and a language-agnostic REST API. Zero paid dependencies beyond what you choose (SMTP provider, hosting).

---

## Two device networks, one gateway

The same gateway endpoint (`gw.proxies.sx:7000` HTTP / `:7001` SOCKS5) routes through either of two device networks — your customer chooses by a token in their proxy username. Same credentials, same DSL, same **$4/GB (volume-discounted to $2.40/GB at 250 GB+; duration is free)** — only the device pool differs.

| Token | Network | Countries | Best for |
|---|---|---|---|
| **`-peer-`** | **The flagship network.** Community devices sharing bandwidth — **mixed mobile + residential home/ISP**, not residential-only. | ~82–120, varies with live supply | The primary product. Widest reach, and home-ISP IPs hold addresses for hours-to-days. Lead with this. |
| **`-mbl-`** | **The supportive carrier-modem tier.** Our own 4G/5G ProxySmart modems, monitored quality. | exactly 6: `us` `gb` `fr` `nl` `pl` `ge` | When a customer needs guaranteed, ultra-stable carrier modems and can live inside six countries. |
| **`-any-`** / **`-best-`** | No pool filter — the selector picks on health and load across both. | union of the two | "Just give me a working IP." |

> **`ge` is GEORGIA, not Germany.** Germany is `de`, and `de` has **no `mbl` stock** — `mbl-de` always fails. Use `peer-de`.

Example proxy URLs (same `pak_` everywhere — only the token changes):

```bash
# Peer — the flagship network
curl -x http://psx_xxx-peer-us:pak_xxx@gw.proxies.sx:7000 https://api.ipify.org

# Carrier modems — the supportive tier
curl -x http://psx_xxx-mbl-us:pak_xxx@gw.proxies.sx:7000 https://api.ipify.org

# Auto-pick across both
curl -x http://psx_xxx-any-us:pak_xxx@gw.proxies.sx:7000 https://api.ipify.org
```

**Per-pool country stock differs.** A country can have modems but no peers, or the reverse. Filter your country picker by the selected pool — `<PoolStockGrid>` and `<PoolSessionSpawner>` model this; live counts (never IPs) come from `GET /v1/gateway/pool/availability`.

The reseller kit exposes the pool toggle in `<PoolSessionSpawner>` and `<PoolDocsPanel>`; if you build your own UI, include the token when constructing the username via `buildProxyUrl` / `buildProxyString` (see `@proxies-sx/pool-sdk`).

**Which pool for sticky-IP workflows?** Sticky pins the **device**, not the IP — mobile carriers re-NAT egress IPs even on a held modem (the gateway weights IP-stability when selecting, but the carrier has the final say). For workflows needing a held IP (cf_clearance, banking, mTLS bound to source IP): use `-peer-` with `-rot-sticky`, add the `strict` flag for a hard stability floor, or lease a **[Reserved IP](./docs/RESERVED-IPS.md)** for an exclusively held device. Full token semantics: **[`docs/USERNAME-DSL.md`](./docs/USERNAME-DSL.md)**. Layer-1-vs-Layer-2 explanation: [Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation).

**Reliability — auto-failover is built in (nothing for you or your customers to handle).** The gateway runs connect-phase auto-failover: if the modem it selects has dropped, that modem is demoted from the pool and a healthy one is retried *before any response is returned* — this is what prevents the occasional `503 / temporarily unavailable`. Your customer controls how wide the replacement may be with the `-failover-` token (`samecountry` default, `samecarrier`, `samenode`, `any`, or `strict` to disable substitution and fail clean). SOCKS5 (`:7001`) additionally falls back to a modem's HTTP CONNECT path (`:7000`) if its SOCKS service is briefly down, so **both ports are equally reliable** — pick whichever your customer's tooling prefers.

---

## Private Pool - reserve dedicated capacity

The shared pool is first-come, first-served. **Private Pool** reserves a private
allocation of devices on the same gateway (`gw.proxies.sx:7000` HTTP / `:7001`
SOCKS5) for isolation and predictable capacity: either **dedicated `-mbl-` modems**
pulled out of the shared pool and exclusively yours for the term, or **committed
`-peer-` capacity** - a guaranteed share of the community network under your own
credentials (not exclusive hardware; peers stay community-shared by nature). Same
`pak_` keys, same username DSL (`-sid-`, `-rot-`, `-city-`, `-carrier-`), just
scoped to your allocation - switching the pool token is the whole integration.

Traffic pricing is identical to the shared pool: $4.00/GB with the standard volume
tiers (-10% from 25 GB, -20% from 50 GB, -30% from 100 GB, -40% from 250 GB). **The
tier comes from the size of a single order, not a monthly total** — 25 orders of
10 GB earn 0%; one order of 250 GB earns 40%. Billed only as used from the same GB
balance that covers both pools ([full table](./docs/PRIVATE-POOL.md#pricing)). The only
addition is a **monthly reservation fee**, quoted per country and pool size. Private
Pool is quote-based, not instant checkout - reserving real devices needs a capacity
check - so you configure and request at
[client.proxies.sx/private-pool](https://client.proxies.sx/private-pool);
availability and price are confirmed within about one business day, then the
allocation is provisioned. Requesting never charges anything.

**Programmatic quality tier (v0.9.0+).** For a modem-only allocation you can
self-provision without a capacity reservation, mint a `pak_` key with
`qualityTier: 'safe'` — the gateway then routes that key across production
ProxySmart modems only (rewriting any `-peer-`/`-any-` request back to `-mbl-`).
Pair it with the `<PrivatePoolPanel>` React component to ship a branded Private
Pool dashboard in one drop-in. See
[`@proxies-sx/pool-sdk`](./packages/sdk/README.md#private-pool--quality-tier-v090)
and [`@proxies-sx/pool-portal-react`](./packages/react/README.md). Full
device-exclusivity + committed peer capacity still go through the quote flow below.

| | `-mbl-` private | `-peer-` private |
|---|---|---|
| What you reserve | Dedicated 4G/5G modems, removed from the shared pool - exclusively yours for the term | Committed capacity on the peer network - guaranteed, not exclusive |
| Coverage | 6 countries (US, GB, FR, NL, PL, GE) | ~82–120 countries |
| IP behavior | Most stable; `-sid-` + `-rot-sticky` pins the modem (the carrier may still re-issue the IP) | IPs rotate naturally on the carrier - a feature for rotation use-cases |
| Best for | Held sessions, consistent throughput, full isolation | Wide coverage, high-volume rotating workloads |

**Reserved IPs** are the exception to "peer capacity is never exclusive": a lease holds
one specific device for one customer, and the credential (`-pin-lease-<id>`) keeps
pointing at it across rotations. A lease can also be rotated to a different device on
demand. **By default a leased device that goes offline is silently substituted with
unreserved shared stock** — acquire with `failover: 'strict'` to fail closed instead.
Full guide: [`docs/RESERVED-IPS.md`](./docs/RESERVED-IPS.md).

For resellers, Private Pool is the natural **premium / enterprise tier**: since it is
quote-based rather than self-serve pak minting, surface it as a "request a quote" /
"contact us" flow and relay the request - a good fit for customers who outgrow the
shared pool or need committed capacity in specific countries. Proxies.sx also builds
custom data-collection software, scrapers, and automation pipelines on top of a
private pool as customers scale. As everywhere on the platform, exit IPs are never
listed - availability is reported as device counts per country only. Details:
[`docs/PRIVATE-POOL.md`](./docs/PRIVATE-POOL.md) and the
[wiki](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Private-Pool).

---

## Two-sided dashboard pattern (recommended for SaaS resellers)

Most production resellers ship **TWO dashboards**, not one:

- **Reseller Admin Panel** (e.g. `admin.brand.com`) — for your operators/staff. Manage tariffs, customers, top-ups, custom per-customer rates, audit logs. Built on your existing admin framework. Doesn't use the React components below.
- **Customer Dashboard** (e.g. `dashboard.brand.com`) — for your end-customers. They see their own pak_ key, spawn proxy URLs, manage own sessions, top up. Built with `@proxies-sx/pool-portal-react`'s drop-in components.

Both share a **single backend layer** with one `ProxiesClient` instance (server-side, holds your `psx_` API key). Admin routes call SDK methods directly; customer routes go through `createPoolApiHandlers()`, which scopes `/me` and `/regenerate` to the caller via `getUserKeyId`.

> **Multi-tenant note:** the `/my-sessions` routes from `createPoolApiHandlers()` have been per-customer scoped since **0.6.0** (they thread the caller's `pakId` via `getUserKeyId`), so they are safe to mount on a customer dashboard. Only pinned-to-0.5.x installs are affected — `npm i @proxies-sx/pool-portal-react@latest` and confirm with `npm view @proxies-sx/pool-portal-react version`.

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

Customers who receive a `pak_` but don't know how to assemble the proxy string
407 once and give up. **Conversion problem #1.**

The shape they need — get this wrong and nothing authenticates:

```
http://psx_YOUR_RESELLER_USERNAME-peer-us:pak_CUSTOMER_KEY@gw.proxies.sx:7000
       └──────────── username: account + routing tokens ────┘ └─ password ─┘
```

**The `pak_` goes in the password field.** The gateway resolves the account from
the *username* only (`proxyUsername`, then `psx_<userId>`, then e-mail) — there
is no code path that resolves a `pak_…` username, so a `pak_xxx-mbl-us`
username fails auth. `buildProxyUrl(proxyUsername, pakKey, opts)` builds this
correctly for you; full grammar in
[`docs/USERNAME-DSL.md`](./docs/USERNAME-DSL.md).

Three ways to get it in front of customers (pick one or stack them):

**1. Build the string with the SDK** — the only path that cannot get the
username/password split wrong:

```ts
import { buildProxyUrl } from '@proxies-sx/pool-sdk';

const url = buildProxyUrl(process.env.PROXIES_SX_USERNAME!, pak.key, {
  pool: 'peer',
  country: 'us',
});
// → http://psx_acme-peer-us:pak_xxx@gw.proxies.sx:7000
```

Show that string verbatim, with a copy button, next to wherever you display the
pak. Whatever else you build, **verify the result routes before shipping it**:

```bash
curl -x "http://<username>:<pak>@gw.proxies.sx:7000" https://api.ipify.org
```

**2. Drop in `<PakQuickstart>`** — React component that renders a 30-second
curl, country picker, sticky toggle, copy buttons, and SOCKS5 / Python / Node /
Playwright snippets:

```tsx
import { PakQuickstart } from '@proxies-sx/pool-portal-react';
import '@proxies-sx/pool-portal-react/styles.css';

<PakQuickstart
  proxyUsername={process.env.NEXT_PUBLIC_PROXIES_SX_USERNAME!}  // REQUIRED — your psx_ reseller username
  pak={pak.key}                                                 // the customer's pak_ → rendered as the PASSWORD
  capGB={pak.trafficCapGB}
  usedGB={pak.trafficUsedMB / 1024}
/>
```

`proxyUsername` is required, and it is the whole reason this component is safe
to hand a customer: it renders `psx_<you>-<pool>-<cc>` in the username field and
your customer's `pak_` in the password field, matching what `buildProxyUrl`
produces. Pass your **reseller `proxyUsername`** (`psx_…`, shown in the
`client.proxies.sx` dashboard) — never the `psx_` **API key**, which is a
different secret and must stay server-side.

**3. Email it on mint** — send the credentials plus a working one-liner. Even a
single line converts far better than no email:

> *"Here's your key. Use it like this:
> `curl -x http://psx_YOURRESELLER-peer-us:pak_xxx@gw.proxies.sx:7000 https://api.ipify.org`"*

Generate that line with `buildProxyUrl` rather than string-concatenating it in
your mailer, so the email and the dashboard can never disagree.

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

> **📦 Install the latest — plain `npm install` gets it.** Installing the React
> package pulls the SDK automatically:
> ```bash
> # Full kit (React components + SDK):
> npm i @proxies-sx/pool-portal-react
> # SDK only:
> npm i @proxies-sx/pool-sdk
> ```
> Check what you actually got with `npm view @proxies-sx/pool-sdk version`; the
> authoritative per-release history is each package's `CHANGELOG.md`.
>
> Highlights since 0.5.x: per-customer session scoping (`sessions.list({ pakId })`),
> corrected `hard` semantics (`hard` pins like sticky, **not** "new IP per request"),
> carrier/ASN/IP-class targeting (`asn` / `isp` / `ipType` + `pool.getCarrierStock()` —
> now scopeable to **all countries at once** and to the `mbl`/`all` pools, so you can
> build a full mobile-vs-residential carrier picker in one call:
> [Carrier / ASN / mobile-vs-residential discovery](./packages/sdk/README.md#carrier--asn--mobile-vs-residential-discovery)),
> client-side `sid` validation in `buildProxyUrl`, the `strict` sticky flag and
> `pin.type: 'lease'` for Reserved IPs, plus the `<PakQuickstart>`,
> `<PrivatePoolPanel>` and `usePoolCarrierStock` React additions.
> Upgrading an existing integration:
> [`docs/MIGRATION-DSL-COMPLETENESS.md`](./docs/MIGRATION-DSL-COMPLETENESS.md).

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

The table above is the full pool-keys surface — there is no public OpenAPI document for it (`/docs/api` and `/docs/seller` are basic-auth gated and 403 anonymously). The publicly readable spec is [api.proxies.sx/docs/gateway](https://api.proxies.sx/docs/gateway) (Pool Gateway API — Private Pool leases, x402 pool).

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
  countries: ['us', 'gb', 'fr', 'nl', 'pl', 'ge'],
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

Larger resellers can negotiate custom wholesale pricing. The published $4/GB base and volume tiers are the self-serve rates. If you are moving serious volume or want committed pricing, contact us to arrange a custom wholesale rate that beats the standard tiers.

**Q: Can I fork and re-brand without attribution?**
A: Yes — MIT license. Do whatever you want. No attribution required.

---

## License

MIT © 2026 Proxies.sx — see [LICENSE](LICENSE).

---

<div align="center">
<sub>Built by <a href="https://proxies.sx">Proxies.sx</a> · Docs: <a href="https://client.proxies.sx/pool-proxy">client.proxies.sx/pool-proxy</a></sub>
</div>
