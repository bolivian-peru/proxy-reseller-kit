# Pool Portal — reseller starter

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

## Setup (10 minutes)

### Requirements

- Node 20+
- pnpm 9+ (install: `corepack enable && corepack prepare pnpm@9 --activate`)
- Docker (optional — only if you want compose-managed Postgres)
- A [Proxies.sx](https://client.proxies.sx) reseller account with an API key (`psx_...`)
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

---

## Customizing

Everything a reseller wants to change lives in **one file**: `src/config.ts`.

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
3. Events: `checkout.session.completed`
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
  ├── customers, purchases                           (app)
  ├── webhook_events                                 (idempotency)
  └── audit_log                                      (key rotations, etc.)

Proxies.sx API
  └── /v1/reseller/pool-keys  (server-side only, via PROXIES_SX_API_KEY)
```

**Key trust boundary:** the reseller API key lives only on the server. The browser talks to the app's own `/api/pool/*` routes, which proxy to Proxies.sx.

### Time-bounded credits (optional)

If your retail product is "10 GB, use within 60 days", set `expiresAt` when minting in the Stripe webhook handler. **Always pass `idempotencyKey`** so a 504 retry doesn't double-mint:

```ts
// src/app/api/stripe/webhook/route.ts — inside handleCheckoutCompleted
const key = await proxies.poolKeys.create({
  label: `customer:${customerId}`,
  trafficCapGB: gbPurchased,
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
  idempotencyKey: `mint_${session.id}`,        // SDK ≥ 0.3.0 — required for retry safety
});
```

On top-up (subsequent purchases by the same customer), prefer `poolKeys.topUp()` (SDK ≥ 0.3.0) over a read-modify-write via `update()`. It's atomic server-side and idempotent:

```ts
await proxies.poolKeys.topUp(customer.pakKeyId, {
  addTrafficGB: gbPurchased,                   // server-side $inc, race-safe
  extendDays: 60,                              // expiresAt = max(now, current) + 60d
  idempotencyKey: `topup_${session.id}`,
});
```

The platform rejects expired keys at the gateway immediately, and the dashboard's `<PoolPortal />` renders an amber banner at < 7 days remaining and a red one once expired (no extra UI work — just include `expiresAt` and `isExpired` in your `/me` response).

---

## Security checklist

- [x] `AUTH_SECRET` is a random 32-byte value (not the example)
- [x] `.env` is in `.gitignore`
- [x] Stripe webhook signature verified (see `src/app/api/stripe/webhook/route.ts`)
- [x] Webhook idempotency via unique `stripe_event_id` in `webhook_events` table
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
| `src/app/api/stripe/webhook/route.ts` | Verifies webhooks, mints pak_ keys |
| `db/schema.sql` | Every table, every index, one file |
| `db/migrate.mjs` | Idempotent schema runner |
| `docker-compose.yml` | Postgres + app |

---

## Contributing upstream

If you fix a bug or add a feature that benefits everyone, please open a PR against
[github.com/bolivian-peru/proxy-reseller-kit](https://github.com/bolivian-peru/proxy-reseller-kit).

## License

MIT — do whatever you want. No attribution required. [LICENSE](../../LICENSE)
