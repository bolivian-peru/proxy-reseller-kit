# Two-Sided Dashboard Pattern — Reseller Best Practice

> **For:** Engineers (and AI agents) building a SaaS dashboard on top of the Proxies.sx Pool Gateway.
> **Authoritative pattern.** Used in production by Coronium and what we recommend to every reseller.
>
> Drop this whole file into Claude Code (or read it as a human). It's structured so an agent can use it as a self-contained spec — every concrete detail you need is here.

---

## TL;DR

**Build two separate dashboards, not one.**

- **Reseller Admin Panel** — for your operators (mint keys for customers, set tariffs, top up balances, audit, set per-customer rates).
- **Customer Dashboard** — for your end-customers (see their own pak_ key, spawn proxy URLs, manage own sessions, top up).

They share a single backend. The Pool SDK lives server-side once and is called from both routes — admin paths skip the per-customer scoping, customer paths apply it via `getSessionUserId()` + `getUserKeyId()`.

This file is a complete spec for both. Pair with [`packages/sdk/README.md`](../packages/sdk/README.md) and [`packages/react/README.md`](../packages/react/README.md).

---

## Why two sides

| Concern | Admin side | Customer side |
|---|---|---|
| Audience | Reseller staff (ops, support, finance) | Reseller's end-customers |
| Auth domain | Admin/staff role | Customer JWT or session cookie |
| Mental model | God-mode — see/edit any customer | Self-service — see/edit own data only |
| Scale concern | One operator manages N customers | One customer sees one account |
| Audit needs | Heavy — every admin action logged | Light — own actions only |
| UI density | High — tables, bulk actions, filters | Low — one customer's reality |
| Failure mode of mixing them | Customer sees other customers' data → P0 incident | — |

The single biggest reason to keep them separate: **the failure modes are catastrophically different.** A bug on the admin side that exposes another customer's data is a regression. A bug on the customer side that does the same thing is a P0 data-leak incident.

---

## Architecture diagram

```
┌─────────────────────────────────┐    ┌──────────────────────────────────┐
│  Reseller Admin Panel           │    │   Customer Dashboard             │
│  admin.brand.com                │    │   dashboard.brand.com            │
├─────────────────────────────────┤    ├──────────────────────────────────┤
│ Route examples:                 │    │ Route examples:                  │
│   /admin/customers              │    │   /pool          (single key)    │
│   /admin/customers/:id          │    │   /pool/sessions                 │
│   /admin/tariffs                │    │   /account                       │
│   /admin/audit                  │    │   /billing                       │
│                                 │    │                                  │
│ React components:               │    │ React components:                │
│   <CustomerListAdmin />         │    │   <PoolPortal />                 │
│   <TariffEditor />              │    │   <PoolSessionSpawner />         │
│   <AuditLog />                  │    │   <ActiveSessionsTable />        │
│   (your own — admin-shaped)     │    │   <PoolDocsPanel />              │
│                                 │    │   <PoolStockGrid />              │
│                                 │    │   (from @proxies-sx/             │
│                                 │    │    pool-portal-react)            │
└──────────────────────────────────┘   └──────────────────────────────────┘
              │                                       │
              │  HTTPS                                │  HTTPS
              ▼                                       ▼
   ┌──────────────────────────┐          ┌──────────────────────────────┐
   │ /api/admin/* routes      │          │ /api/pool/* routes           │
   │ (your auth: admin role)  │          │ (your auth: customer JWT)    │
   ├──────────────────────────┤          ├──────────────────────────────┤
   │ Hand-rolled handlers.    │          │ createPoolApiHandlers() from │
   │ Each calls proxies.poolKeys│         │ @proxies-sx/pool-portal-react│
   │ directly, with the       │          │ /server. Wires getSessionUser│
   │ customer's keyId from a  │          │ Id() → returns the requestor │
   │ URL param or body field. │          │ → getUserKeyId() finds that  │
   │                          │          │ customer's pak_id only.      │
   └──────────────────────────┘          └──────────────────────────────┘
                  └─────────────────┬─────────────────┘
                                    ▼
                       ┌───────────────────────────┐
                       │  Single ProxiesClient     │
                       │  (server-side singleton)  │
                       │                           │
                       │  apiKey: psx_...          │
                       │  proxyUsername: psx_...   │
                       │                           │
                       │  poolKeys.create()        │
                       │  poolKeys.list()          │
                       │  poolKeys.get(id)         │
                       │  poolKeys.topUp(id, ...)  │
                       │  poolKeys.regenerate(id)  │
                       │  poolKeys.delete(id)      │
                       │  sessions.list()          │
                       │  sessions.close(key)      │
                       │  sessions.closeAll()      │
                       └───────────────────────────┘
                                    │
                                    ▼
                       ┌───────────────────────────┐
                       │ api.proxies.sx/v1/        │
                       │ reseller/pool-keys        │
                       │ gateway/pool/*            │
                       └───────────────────────────┘
                                    │
                                    ▼
                       ┌───────────────────────────┐
                       │   gw.proxies.sx:7000      │
                       │   (HTTP proxy gateway)    │
                       │   gw.proxies.sx:7001      │
                       │   (SOCKS5)                │
                       └───────────────────────────┘
```

---

## Side A: Reseller Admin Panel

### Audience + capabilities

Reseller operations staff. Capabilities you build:

1. **Customers (CRUD).** Create new sub-accounts, suspend/unsuspend, ban, soft-delete. Show usage per customer. Per-customer view: pak_ key, traffic used, balance, last-active, list of sessions.
2. **Tariff management.** Define your retail price tiers (e.g. "10 GB / $30 / 30 days"). Edit, deprecate. Don't rename ids after launch — customers' billing references them.
3. **Mint / regenerate / revoke pak_** on a customer's behalf (impersonation). Useful for support workflows where the customer can't do it themselves.
4. **Top up customer balance.** Admin credit grants — gives them N GB without a payment.
5. **Set custom rates per customer.** "VIP customer Foo gets $2/GB instead of standard $4."
6. **Aggregate stats.** Total customers, active customers, total traffic, MRR, churn.
7. **Audit log.** Every admin action recorded with operator id + timestamp.
8. **Per-customer impersonation.** Click a customer → see their dashboard exactly as they see it. Useful for debugging customer-reported issues.

### What it does NOT do

- It does NOT use `<PoolPortal>`, `<PoolSessionSpawner>`, `<ActiveSessionsTable>`, `<PoolDocsPanel>`, `<PoolStockGrid>`. Those are customer-facing single-account views; admin needs multi-customer tables which look different.
- It does NOT mint API keys for end customers (those go through your own user-management).
- It does NOT need its own `createPoolApiHandlers()` — admin paths call `ProxiesClient` methods directly.

### Tech shape

```ts
// /api/admin/customers/:id/topup (your route, not from the SDK)
import { proxies } from '@/lib/proxies';                  // singleton ProxiesClient
import { requireAdmin } from '@/lib/auth';
import { db } from '@/lib/db';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const operator = await requireAdmin(req);                // 401 if not admin
  const customer = await db.customers.get(params.id);
  const { addTrafficGB, extendDays } = await req.json();

  await proxies.poolKeys.topUp(customer.pakKeyId, {
    addTrafficGB,
    extendDays,
    idempotencyKey: `admin_topup_${operator.id}_${Date.now()}`,
  });

  await db.auditLog.create({
    operator: operator.id,
    action: 'pool.topup',
    customerId: customer.id,
    details: { addTrafficGB, extendDays },
  });

  return Response.json({ ok: true });
}
```

**Authz pattern:** the admin route uses `requireAdmin()` (your code). The SDK call doesn't know about admin vs customer — it just calls Proxies.sx with your `psx_` key. Authorization happens entirely in YOUR auth layer.

### Data model on your side

You need (at minimum):

```
users (id, email, role: 'customer' | 'admin', ...)
customers (user_id, pak_key_id, pak_idempotency_key, total_gb_purchased,
           created_at, suspended_at, suspended_reason, custom_rate_usd_per_gb)
tariffs (id, name, gb, price_usd, expiry_days, retired_at)
purchases (id, customer_id, tariff_id, amount_usd, gb, created_at,
           stripe_session_id, idempotency_key)
audit_log (id, operator_id, action, customer_id, details_json, ts)
```

Note `custom_rate_usd_per_gb` per customer — for the "VIP rate" use case. Your billing layer reads this when applying tariffs.

---

## Side B: Customer Dashboard

### Audience + capabilities

End-customers. Self-service. Capabilities you build:

1. **See own pak_ key + usage.** Used GB / Cap GB, days until expiry. Use `<PoolPortal>` for the single-key view.
2. **Spawn proxy URLs.** Use `<PoolSessionSpawner>` — generates N proxy strings with the username DSL.
3. **Manage own sessions.** Use `<ActiveSessionsTable>` — list, close one, close all.
4. **Read DSL docs.** Use `<PoolDocsPanel>` — how-it-works flow, username token reference, rotation modes, example curl pre-filled with their username.
5. **See live country stock.** Use `<PoolStockGrid>` — endpoints online per country, updated every 30 s.
6. **Top up own balance.** Your own Stripe / CoinGate / payment-rail integration; credits the customer's balance, then your billing layer extends their pak_ via `poolKeys.topUp()`.
7. **View own activity.** Recent purchases, traffic over time, support tickets.

### Tech shape (Next.js)

```ts
// app/api/pool/[[...path]]/route.ts
import { createPoolApiHandlers } from '@proxies-sx/pool-portal-react/server';
import { proxies } from '@/lib/proxies';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';

export const { GET, POST, DELETE } = createPoolApiHandlers({
  proxies,
  getSessionUserId: async () => (await auth())?.userId ?? null,
  getUserKeyId: async (userId) => (await db.customers.get(userId))?.pak_key_id ?? null,
  onAudit: (event) => analytics.track(`pool.${event.type}`, event),
});
```

**The trust boundary:** `psx_` API key lives only in `proxies` (server-side singleton). The browser never sees it. `getSessionUserId` enforces auth. `getUserKeyId` enforces ownership. The customer can ONLY interact with their own pak_id.

### Page composition (the Coronium-style pattern)

```tsx
'use client';

import {
  PoolPortal,
  PoolSessionSpawner,
  ActiveSessionsTable,
  PoolDocsPanel,
  PoolStockGrid,
} from '@proxies-sx/pool-portal-react';

export default function PoolPage({ me }: { me: MeResponse }) {
  return (
    <main className="w-full max-w-screen-2xl mx-auto px-6 lg:px-12 py-8 space-y-8">
      {/* 1. Banner / billing card / multi-tariff buy form (your own UI) */}
      <YourBetaBanner />

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <YourAccountCreditCard />
          <YourTariffBuyForm />
        </div>
        <aside>
          <h2>Live country stock</h2>
          <PoolStockGrid apiRoute="/api/pool" countries={['us','gb','fr','nl','pl','ge']} />
        </aside>
      </section>

      {/* 2. Single-key view */}
      <section>
        <h2>Your proxy</h2>
        <PoolPortal apiRoute="/api/pool" branding={{ name: 'BrandName', primaryColor: '#7c3aed' }} />
      </section>

      {/* 3. Multi-port spawner */}
      <section>
        <h2>Generate multiple proxies</h2>
        <PoolSessionSpawner
          proxyUsername={me.proxyUsername}
          proxyPassword={me.pakKey}
          countries={['us','gb','fr','nl','pl','ge']}
          defaultPool="mbl"
          defaultRotation="sticky"
          defaultSessionType="unique"
        />
      </section>

      {/* 4. Active sessions table */}
      <section>
        <h2>Active sessions</h2>
        <ActiveSessionsTable
          apiRoute="/api/pool"
          proxyPassword={me.pakKey}
          refreshIntervalMs={5_000}
        />
      </section>

      {/* 5. Technical reference */}
      <section>
        <h2>How the gateway works</h2>
        <PoolDocsPanel
          proxyUsername={me.proxyUsername}
          exampleSamplePassword={me.pakKey}
        />
      </section>
    </main>
  );
}
```

---

## The shared backend layer

**Single `ProxiesClient` instance, server-side, used by both admin and customer routes.**

```ts
// lib/proxies.ts — IMPORT EVERYWHERE FROM THIS FILE
import { ProxiesClient } from '@proxies-sx/pool-sdk';

if (!process.env.PROXIES_SX_API_KEY) throw new Error('PROXIES_SX_API_KEY required');
if (!process.env.PROXIES_SX_USERNAME) throw new Error('PROXIES_SX_USERNAME required');

export const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY,
  proxyUsername: process.env.PROXIES_SX_USERNAME,
  retry: { attempts: 3, baseDelayMs: 250, maxDelayMs: 4_000 },  // SDK 0.3.0+
});
```

**Critical guard rails:**

- This file is server-only. Add it to your bundler's server-only allowlist (Next.js: top of file, `import 'server-only';`).
- The `psx_` API key NEVER appears in browser code, browser bundles, or response bodies.
- All write paths (admin AND customer) pass `idempotencyKey` derived from a domain object (operator id + timestamp for admin actions, Stripe event id for customer payments).

---

## Reference: Coronium's deployment

For a real example, Coronium ships:

- **`admin.coronium.io/beta`** → admin panel, Customer Tools tab. Lets staff impersonate a customer, mint/topup their pak_, audit their pool usage.
- **`dashboard.coronium.io/en/pool`** → customer dashboard. Uses all five pool-portal-react components composed in the layout above.
- **Backend**: `coronium-backend` Express app exposes `/api/v1/admin/pool/*` (cookie-auth admin) and `/api/v1/account/pool/*` + `/api/v3/pool/*` (cookie/JWT customer). Both wrap the same `ProxiesClient`.

The split has soaked since 2026‑05‑01 with no admin-vs-customer permission bugs.

---

## AI agent prompt — how to plan a build

If a user asks to "build a Pool dashboard for my reseller business" and you're an AI agent:

1. **Ask first**: "Admin side, customer side, or both? They have different audiences and different stacks."
2. **Confirm tech stack** for the side(s) they're building.
3. **Default recommendation**: build customer side first using `@proxies-sx/pool-portal-react@^0.4.1`. Faster — most components are drop-in. Then layer admin on their existing admin framework, calling `ProxiesClient` methods directly.
4. **Don't reuse customer-side React components for admin pages.** They're shaped for one-customer-self-service; admin needs N-customer tables. Admin pages are bespoke.
5. **Always pass `idempotencyKey` on writes.** Tie to a domain object — Stripe event id, ledger entry id, support-ticket id, operator-action id. Never generate inside a retry loop.
6. **Always log `ProxiesApiError.requestId`** — paste in support tickets to trace server-side without describing what time it happened.
7. **Auth lives in YOUR app**, not in the SDK. Admin role / customer role / scope checks are your responsibility. The SDK trusts the caller.

---

## Side-by-side feature matrix

| Capability | Admin side | Customer side |
|---|---|---|
| Mint pak_ for self | ❌ | ✅ (via your tariff buy flow) |
| Mint pak_ for any customer | ✅ | ❌ |
| Top up own balance | ❌ | ✅ |
| Top up any customer's balance | ✅ | ❌ |
| List own sessions | ❌ | ✅ via `<ActiveSessionsTable>` |
| List ALL customers' sessions | ✅ (via gateway `/sessions/active`) | ❌ |
| Close own session | ❌ | ✅ via SDK `sessions.close()` |
| Close any customer's session | ✅ | ❌ |
| View own usage | ❌ | ✅ |
| View aggregate usage | ✅ | ❌ |
| Set custom per-customer rate | ✅ | ❌ |
| Read pool DSL docs | ❌ (knows already) | ✅ via `<PoolDocsPanel>` |
| See live stock | Probably useful | ✅ via `<PoolStockGrid>` |
| Audit log of own actions | ✅ as operator | ✅ as actor |

---

## Common mistakes to avoid

1. **Mixing admin + customer routes in one Next.js handler.** They have different auth requirements; separate them by file.
2. **Shipping admin features inside `<PoolPortal>`.** That's the customer view. Build admin tables separately.
3. **Calling `proxies.poolKeys.list()` from the customer dashboard.** That returns ALL the reseller's pak_ keys — leaks every customer's id to whoever logs in. Always go through `getUserKeyId()` to scope to one customer.
4. **Putting `psx_` in browser-readable code.** The SDK is server-only. Ban imports of `@proxies-sx/pool-sdk` from anything inside `'use client'` or `client/` directories.
5. **Skipping `idempotencyKey` on writes.** Webhook/payment retries WILL happen. The platform dedupes with the key; without one, you'll mint two pak_ keys for one Stripe event.
6. **Building one admin "act-as-customer" view that re-uses customer components.** Tempting, but the customer components polling `/api/pool/me` won't return the impersonated customer's data unless your `getSessionUserId()` callback is impersonation-aware. Simpler: admin has its own customer-detail page that calls `proxies.poolKeys.get(impersonatedCustomerKeyId)` directly.

---

*Pattern in production at Coronium. Authoritative. Update this doc when you discover new constraints — don't fork it into your own README.*
