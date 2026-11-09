# Pool Portal — reseller starter

> **Shared-pool contract update — 4 November 2026:** the [current release table and recovery contract](../../docs/SHARED-POOL-CONTRACT.md) supersede older shared-key retry, automatic resume and session-release guidance here. Candidate APIs require verified provider deployment; package installation alone does not activate them. Persist intent, make one mutation attempt, recover by read-only operation lookup, and never resume from routine sync. Private-pool and provider-managed x402 payment flows remain separate.

**Explicitly choose `pool`; do not rely on the SDK mobile-pool default.**
URL builders default to `mbl`; choose `peer` for the shared SDK network,
`peer` plus `ipType: 'residential'` for residential-only routing, or `any` only
when mixed pools are intended. A `qualityTier: 'safe'` PAK forces `mbl`.
Keep discovery and generated connections on the same chosen pool.
See [pool selection](../../docs/USERNAME-DSL.md#choose-the-pool-explicitly) before copying examples.

> Self-hosted branded storefront for the [Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy). Next.js 15, NextAuth, raw Postgres, Stripe. Zero paid dependencies beyond what you choose.

**What you get out of the box:**
- Landing page with 3 pricing tiers (fully configurable)
- Magic-link email sign-in (NextAuth; works with any SMTP, console-logger for dev)
- Stripe Checkout integration — customer pays, webhook auto-mints their proxy key
- Dashboard with the embedded `<PoolPortal>` component (copy URL, rotation, usage bar)
- Postgres schema in one `.sql` file, no ORM, no migrations framework
- Docker Compose for self-hosting anywhere

Total lines of app code: **under 1000** including comments. You can read it all in 20 minutes.

---

## Production payment gate

The webhook delivers a paid checkout through a journal on the `purchases` table:

1. It verifies the Stripe signature and ignores a session whose `payment_status`
   is not `paid`. A delayed payment method is delivered when
   `checkout.session.async_payment_succeeded` arrives.
2. It records the purchase as `pending` and stores the provider
   `Idempotency-Key` (`mint_<session id>` or `topup_<session id>`) before it
   calls the provider.
3. It marks the purchase `delivered` only after the provider confirmed. Until
   then it answers 500, so Stripe retries.
4. A retry reads the operation stored under the same key. It sends only when the
   provider never admitted that key, so one payment is delivered once. A key the
   provider rejected proves no effect and is replaced by `..._2`, `..._3`.
5. After a top-up it resumes the key when its only hold is `cap`. A key disabled
   for another reason (manual, expired, account or security review) stays
   disabled and a warning is logged. Review and resume that key yourself.

A second purchase of the same customer waits (500, retried by Stripe) while an
earlier one is still undelivered, so two checkouts never mint two keys.

Verify these limits against your own deployment before taking live payments:

- Recovery runs on Stripe retries only. There is no background worker. Stripe
  retries a failed webhook for a limited time (up to three days in live mode at
  the time of writing). A purchase that is still pending after that needs a
  manual look: `SELECT * FROM purchases WHERE delivery_state = 'pending'`.
- Refund and dispute events are not handled, and the amount paid is not compared
  with the tier price.
- Purchases recorded before the journal existed are treated as delivered. They
  are not reconciled or sent again.
- The tests use fakes for Stripe and the provider and a real PostgreSQL for the
  journal. Nothing here was exercised against live Stripe or the live provider.

Existing deployments must run `pnpm db:migrate` to add the journal columns.
Remaining work is tracked in
[issue #4](https://github.com/bolivian-peru/proxy-reseller-kit/issues/4).

Provider lifecycle fixes do not automatically repair this application-level
workflow. This limitation applies to `apps/starter`, not independently implemented
custom integrations such as Portproof.

## Setup (10 minutes)

### Requirements

- Node 20+
- pnpm 9+ (install: `corepack enable && corepack prepare pnpm@9 --activate`)
- Docker (optional — only if you want compose-managed Postgres)
- A [Proxies.sx](https://client.proxies.sx) account with reseller access (granted by Proxies.sx on request) and an API key (`psx_...`) carrying `customers:read`, `customers:write`, `ports:read`, `ports:write`, `traffic:read`
- A [Stripe](https://dashboard.stripe.com) account (test mode is fine)

### 1. Clone + install

```bash
git clone https://github.com/bolivian-peru/proxy-reseller-kit.git my-shop
cd my-shop/apps/starter
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` — the only **required** values for local dev are:

```bash
DATABASE_URL=postgres://pool:pool@localhost:5432/pool_portal
AUTH_SECRET=$(openssl rand -base64 32)
PROXIES_SX_API_KEY=psx_yourkey
PROXIES_SX_USERNAME=psx_yourid
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...    # from `stripe listen`
```

Leave `EMAIL_SERVER_*` blank in dev — the app prints magic links to the server console.

### 3. Start Postgres + migrate

```bash
# Option A: docker compose (ships with Postgres)
docker compose up -d db

# Option B: your own Postgres — just set DATABASE_URL

pnpm db:migrate
```

### 4. Run

```bash
pnpm dev
# → http://localhost:3000
```

In another terminal, forward Stripe webhooks:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
# copy the printed whsec_... into .env as STRIPE_WEBHOOK_SECRET, restart dev
```

### 5. Buy your first test plan

1. Go to http://localhost:3000
2. Click **Sign in** → enter any email
3. Find the magic link in the server console, open it
4. On the dashboard, click **Buy**
5. Stripe test card: `4242 4242 4242 4242`, any future date, any CVC
6. Webhook fires → pak_ key minted on Proxies.sx → dashboard shows your proxy URL

Run the webhook tests with `pnpm test`. Set `TEST_DATABASE_URL` to a disposable Postgres to include the journal SQL test.

---

## Customizing

Branding, prices and offered countries live in `src/config.ts`. Also choose the
`pool` prop explicitly in `src/app/dashboard/page.tsx` before changing countries.
The starter explicitly uses `mbl`; change it to `peer` for the mixed SDK network
or `any` only when both pools are intended. Use current stock for that choice.

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

Change these values and restart. No code edits needed for 90% of customizations.

---

## Deploying to production

### Docker Compose (recommended for single-VPS deploys)

```bash
# On your server:
git clone <your-fork> pool-portal && cd pool-portal/apps/starter
cp .env.example .env  &&  nano .env    # fill in production values
docker compose up --build -d
```

Point a reverse proxy at `localhost:3000`:

**Caddy**
```
yourdomain.com {
  reverse_proxy localhost:3000
}
```

**nginx**
```nginx
server {
  server_name yourdomain.com;
  location / { proxy_pass http://localhost:3000; proxy_set_header Host $host; }
  listen 443 ssl;
  # ...ssl config via certbot
}
```

### Setting up Stripe in production

1. Dashboard → Developers → Webhooks → **Add endpoint**
2. Endpoint URL: `https://yourdomain.com/api/stripe/webhook`
3. Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
4. Copy the signing secret into `.env` as `STRIPE_WEBHOOK_SECRET`
5. Restart the app

### Setting up email (optional but recommended)

Any SMTP provider works. Cheapest free-tier options:

| Provider | Free tier | Host |
|---|---|---|
| [Resend](https://resend.com) | 3k/month | `smtp.resend.com` |
| [Postmark](https://postmarkapp.com) | 100/month | `smtp.postmarkapp.com` |
| [Amazon SES](https://aws.amazon.com/ses/) | ~62k/month from EC2 | `email-smtp.us-east-1.amazonaws.com` |
| Your own Postfix | unlimited | your mail server |

Fill in `EMAIL_SERVER_*` + `EMAIL_FROM` in `.env` and restart.

---

## Architecture

```
Browser
  │
  ├── /login               → NextAuth magic link
  ├── /dashboard           → <PoolPortal /> (React component)
  └── /api/stripe/checkout → Stripe Checkout redirect

Server (Next.js App Router)
  │
  ├── /api/auth/*          → NextAuth (Auth.js v5) handlers
  ├── /api/pool/*          → createPoolApiHandlers() — proxies to Proxies.sx
  └── /api/stripe/webhook  → verifies + provisions pak_ keys

Postgres
  ├── users, accounts, sessions, verification_token  (NextAuth)
  ├── customers, purchases                           (app; purchases is the delivery journal)
  ├── webhook_events                                 (handled Stripe events)
  └── audit_log                                      (key rotations, etc.)

Proxies.sx API
  └── /v1/reseller/pool-keys  (server-side only, via PROXIES_SX_API_KEY)
```

**Key trust boundary:** the reseller API key lives only on the server. The browser talks to the app's own `/api/pool/*` routes, which proxy to Proxies.sx.

### Time-bounded credits (optional)

If your retail product is "10 GB, use within 60 days", set `expiresAt` where the starter mints, in `dispatch()` in `src/lib/fulfillment.ts`. The key passed as `idempotencyKey` is already stored on the purchase before dispatch, and a retry reads the original operation instead of issuing another create:

```ts
// src/lib/fulfillment.ts, inside dispatch()
return poolKeys.create({
  label: `customer:${userId}`,
  trafficCapGB: gb,
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
  idempotencyKey: token,                       // stored on the purchase before dispatch
});
```

On top-up (subsequent purchases by the same customer), prefer `poolKeys.topUp()` (SDK ≥ 0.3.0) over a read-modify-write via `update()`. It avoids a lost cap update, but your host still needs durable intent, serialization and read-only recovery:

```ts
return poolKeys.topUp(keyId, {
  addTrafficGB: gb,                            // server-side $inc, race-safe; whole GB only
  extendDays: 60,                              // expiresAt = max(now, current) + 60d
  idempotencyKey: token,
});
```

The platform rejects expired keys at the gateway immediately, and the dashboard's `<PoolPortal />` renders an amber banner at < 7 days remaining and a red one once expired (no extra UI work — just include `expiresAt` and `isExpired` in your `/me` response).

---

## Security checklist

- [x] `AUTH_SECRET` is a random 32-byte value (not the example)
- [x] `.env` is in `.gitignore`
- [x] Stripe webhook signature verified (see `src/app/api/stripe/webhook/route.ts`)
- [x] One delivery per paid checkout session: `purchases.delivery_state` and a stored provider `Idempotency-Key`
- [x] All SQL queries parameterized (`pg` `$1` placeholders, never string interpolation)
- [x] `PROXIES_SX_API_KEY` not imported in any `'use client'` file
- [x] `/me` responses sent with `Cache-Control: private, no-store`
- [x] Session-bound user id resolved server-side, never from the client
- [ ] **TODO for you:** lock down admin email allowlist if you want an admin page (see CLAUDE.md)

---

## Files reference

| File | What it does |
|---|---|
| `src/config.ts` | Brand + pricing. Edit this. |
| `src/lib/db.ts` | Postgres pool + `query()` / `queryOne()` helpers |
| `src/lib/auth.ts` | NextAuth config, magic-link + PgAdapter |
| `src/lib/proxies.ts` | `ProxiesClient` singleton |
| `src/lib/stripe.ts` | Stripe SDK singleton |
| `src/app/page.tsx` | Landing + pricing |
| `src/app/login/page.tsx` | Email sign-in |
| `src/app/dashboard/page.tsx` | User dashboard with `<PoolPortal>` |
| `src/app/api/auth/[...nextauth]/route.ts` | NextAuth routes |
| `src/app/api/pool/[...path]/route.ts` | Proxies to the Pool Gateway API |
| `src/app/api/stripe/checkout/route.ts` | Creates Stripe Checkout sessions |
| `src/app/api/stripe/webhook/route.ts` | Verifies webhooks, delivers paid sessions |
| `src/lib/fulfillment.ts` | Delivery logic: mint or top-up, recovery, cap-hold resume |
| `src/lib/fulfillment-store.ts` | Delivery journal SQL on `purchases` |
| `db/schema.sql` | Every table, every index, one file |
| `db/migrate.mjs` | Idempotent schema runner |
| `docker-compose.yml` | Postgres + app |

---

## Contributing upstream

If you fix a bug or add a feature that benefits everyone, please open a PR against
[github.com/bolivian-peru/proxy-reseller-kit](https://github.com/bolivian-peru/proxy-reseller-kit).

## License

MIT — do whatever you want. No attribution required. [LICENSE](../../LICENSE)
