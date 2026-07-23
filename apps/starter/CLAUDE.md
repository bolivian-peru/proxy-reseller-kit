# CLAUDE.md — Pool Portal starter

> Reading this means you're an AI agent helping a human deploy or customize their branded proxy reseller portal. This file is authoritative. Read it before touching source.

## What this app is

A self-hosted branded reseller portal for the [Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy). Next.js 15 App Router, NextAuth (Auth.js v5) magic-link login, raw Postgres (no ORM), Stripe checkout. Zero paid dependencies besides what the operator chooses (SMTP provider, hosting).

**Engineering principles apply here too.** The kit-wide principles (preserve behavior, clarity over brevity, no nested ternaries, scope discipline — inherited from Anthropic's [`code-simplifier`](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md)) are stated in full in the [parent `CLAUDE.md`](../../CLAUDE.md#engineering-principles-how-to-write-code-in-this-repo). This is a *template the operator will own and modify* — so the bar is "leave them a codebase they can confidently change," not "show off." When the operator's taste diverges from this starter's, their taste wins; this scaffold is a starting point, not a cage. Customize freely above the floor of the security rules in "Don't do these things."

## Repo shape

```
apps/starter/
├── src/
│   ├── config.ts                 ← EDIT THIS for brand + pricing
│   ├── lib/                      ← db, auth, proxies, stripe singletons
│   ├── app/
│   │   ├── page.tsx              ← landing + pricing
│   │   ├── login/page.tsx
│   │   ├── dashboard/page.tsx    ← uses <PoolPortal>
│   │   └── api/
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── pool/[...path]/route.ts
│   │       └── stripe/
│   │           ├── checkout/route.ts
│   │           └── webhook/route.ts
│   └── app/globals.css
├── db/
│   ├── schema.sql                ← all tables in one file
│   └── migrate.mjs               ← idempotent migration runner
├── docker-compose.yml            ← ships Postgres + app
├── Dockerfile
├── .env.example
└── package.json
```

## Common agent tasks

### Change brand name, logo, or primary color
Edit `src/config.ts`. The value flows to the landing page, layout header, emails (when implemented), and the PoolPortal component's `branding` prop.

### Change pricing tiers
Edit the `pricing` array in `src/config.ts`. Each tier needs `id`, `displayName`, `gb`, `priceUsd`. The `id` is stored in Stripe metadata and in the `purchases` table, so don't rename existing ids after launch — add new ones instead.

### Add a new country to the dashboard
Add the ISO code to `config.countries` in `src/config.ts`. Must be a valid `Country` from `@proxies-sx/pool-sdk` (the mbl tier covers `'us' | 'gb' | 'fr' | 'nl' | 'pl' | 'ge'`; the peer network spans 80+).

### Change the DB schema
Edit `db/schema.sql`. Every statement must use `IF NOT EXISTS` / `ON CONFLICT` — the migration runner is idempotent and re-runs the whole file. If you need to drop or alter, add the ALTER/DROP statement with `IF EXISTS` guards.

### Run a SQL query from code
```ts
import { query, queryOne } from '@/lib/db';
const rows = await query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
const single = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
```
**Always use parameterized queries (`$1`, `$2`, …). Never concatenate.**

### Add a new Stripe event handler
Extend `handleCheckoutCompleted` in `src/app/api/stripe/webhook/route.ts`, or branch on `event.type` in the main handler. Idempotency is enforced by the `webhook_events` table (a unique `stripe_event_id`). If your handler throws, the row is deleted so Stripe retries will re-run it.

### Add an expiry to minted keys (time-bounded credits)
The platform supports `expiresAt` on `pak_` keys (SDK ≥ 0.2.0). To ship "10 GB, use within 60 days":

1. In `handleCheckoutCompleted`, pass `expiresAt` when minting:
   ```ts
   const key = await proxies.poolKeys.create({
     label: `customer:${customerId}`,
     trafficCapGB: gbPurchased,
     expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
     idempotencyKey: `mint_${session.id}`,  // safe to retry on 504 (SDK ≥ 0.3.0)
   });
   ```
2. On subsequent top-ups, prefer `poolKeys.topUp()` (SDK ≥ 0.3.0) over a
   read-modify-write via `update()`. It's atomic server-side and idempotent:
   ```ts
   await proxies.poolKeys.topUp(customer.pak_key_id, {
     addTrafficGB: tier.gb,        // server $inc, race-safe
     extendDays: 60,               // expiresAt = max(now, current) + 60d
     idempotencyKey: `topup_${session.id}`,
   });
   // Platform behavior since SDK 0.5.0: if the key was auto-suspended
   // for hitting its cap, topUp does NOT auto re-enable. For confirmed
   // payment paths (Stripe webhook from the actual account owner),
   // lift the suspend explicitly:
   await proxies.poolKeys.update(customer.pak_key_id, { enabled: true });
   ```
3. Surface `expiresAt` and `isExpired` in the `/api/pool/me` response —
   `<PoolPortal />` will render the countdown banner automatically.

The gateway rejects expired keys inline (no waiting for a cron). The platform's nightly cron at 03:30 UTC just flips `enabled = false` for tidy admin queries; do NOT rely on it for revocation.

### Auto-suspend on cap exceeded (SDK ≥ 0.5.0)

When a customer's `pak_` hits its `trafficCapGB`, the platform atomically flips `enabled = false` and writes an `auto_suspended_cap_exceeded` audit event. **`topUp()` doesn't auto re-enable** — that's intentional, so a leaked key can't auto-recover from a cap suspend without owner review.

If your auto-topup runs on a confirmed payment from the account owner (Stripe webhook in the starter), pair `topUp` + explicit `update({ enabled: true })`. The starter's `src/app/api/stripe/webhook/route.ts` already does this in `handleCheckoutCompleted`.

### Audit log (SDK ≥ 0.5.0)

Three new methods for forensic visibility:

```ts
// Cross-key (90d retention, server-side TTL)
const events = await proxies.poolKeys.audit({ action: 'gateway_auth_failure', limit: 100 });

// Single-key (good for "my key stopped working" support flows)
const recent = await proxies.poolKeys.auditForKey(keyId, { limit: 50 });

// Audit-logged unmask — replace any "show full pak_" UI with this
const fresh = await proxies.poolKeys.reveal(keyId);   // records `reveal` event
```

Use `audit({ action: 'auto_suspended_cap_exceeded' })` periodically to spot customers who are hitting caps but not topping up — could be a billing issue or a leaked key.

### Idempotency, retry, and request-id (SDK ≥ 0.3.0)

The SDK now retries on 5xx/429/timeouts/network errors with full jitter
and honors `Retry-After`. Skip 4xx (except 429). **Don't wrap your own
retry** — combining causes thundering herd. Override per call site:

```ts
const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY!,
  retry: { attempts: 5, baseDelayMs: 500, maxDelayMs: 8_000 },
  // or `retry: false` to fully disable
});
```

Pass `idempotencyKey` on every write call from a webhook/payment flow
(`create`, `topUp`, `regenerate`). Tie it to a domain object (Stripe
event id, ledger id, invoice id) so the value is stable across retries.

When errors happen, log `err.requestId` — that's the `X-Request-ID` the
platform uses to look up your request server-side. Paste it in support
tickets to skip log-grepping.

```ts
catch (err) {
  if (err instanceof ProxiesApiError) {
    logger.error({ status: err.status, requestId: err.requestId, body: err.body });
  }
  throw err;
}
```

### Accept USDC from AI agents via x402 (alongside Stripe)

The starter ships Stripe for human card payments. To *also* sell to autonomous AI-agent customers, add a second payment rail on the same app — both settle into the same `psx_` account, so your wholesale economics are identical. The agent hits a 402 endpoint, pays USDC on Base/Solana, retries with the transaction hash, and you mint a `pak_` capped at what they paid.

This is a **new route**, not a change to the Stripe flow — add it, don't refactor checkout (scope discipline). The full drop-in handler lives in [`docs/X402-RESELLER-INTEGRATION.md`](../../docs/X402-RESELLER-INTEGRATION.md); drop it at `src/app/api/x402-proxy/route.ts`. Set the wallet + price env vars per the [x402 and Wallet Setup wiki page](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/x402-and-Wallet-Setup), and add them to `.env.example` in the same commit (the env-var rule below). The mint call is the same `proxies.poolKeys.create()` you already use in the Stripe webhook — with the on-chain transaction hash as the `idempotencyKey` so agent retries never double-mint.

### Switch from the dev console-logger to real email
Set `EMAIL_SERVER_HOST`, `EMAIL_SERVER_PORT`, `EMAIL_SERVER_USER`, `EMAIL_SERVER_PASSWORD`, `EMAIL_FROM` in `.env`. NextAuth picks them up automatically (see `src/lib/auth.ts` — the presence of `EMAIL_SERVER_HOST` + `EMAIL_FROM` flips SMTP on).

### Add an admin-only page
Check the session email against an env allowlist:
```ts
const admins = (process.env.ADMIN_EMAILS ?? '').split(',').filter(Boolean);
if (!session?.user?.email || !admins.includes(session.user.email)) redirect('/');
```

## Don't do these things

- **Never** commit `.env`. Only `.env.example`.
- **Never** expose `PROXIES_SX_API_KEY` or `STRIPE_SECRET_KEY` to client components. They are server-only. Keep imports of `@/lib/proxies`, `@/lib/stripe` out of `'use client'` files.
- **Never** skip webhook signature verification in `src/app/api/stripe/webhook/route.ts`. If you need to test without Stripe, use `stripe listen` — don't comment out the check.
- **Never** trust `session.user.id` without the NextAuth session callback setting it. If you change the auth config, update `src/lib/auth.ts` callbacks accordingly.
- **Never** use string interpolation in SQL. Parameters are `$1`, `$2`, … via `pg`.

## Running the app

### First-time setup (dev)
```bash
cp .env.example .env
# edit .env: DATABASE_URL, PROXIES_SX_*, STRIPE_*, AUTH_SECRET

# 1. Start Postgres (or use your own)
docker compose up -d db

# 2. Install + migrate
pnpm install
pnpm db:migrate

# 3. Run dev server
pnpm dev

# 4. For Stripe webhooks, in another terminal:
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Login: enter your email at /login. Without SMTP configured, the magic link prints to the server console — click it.

### Production deploy (Docker Compose)
```bash
# On your server:
git clone <this repo> .
cp .env.example .env
# fill in prod values

docker compose up --build -d
```

The app auto-runs migrations on container start. Postgres data persists in the `pool_db_data` volume.

### Reverse proxy / SSL
Terminate TLS at nginx/Caddy in front of the app. Example Caddy config:
```
yourdomain.com {
  reverse_proxy localhost:3000
}
```

## Environment variables

Every variable used by the app is documented in `.env.example`. The agent rule: if code references a new env var, add it to `.env.example` in the same commit, with a comment explaining why.

## Debugging

- **"DATABASE_URL is not set"** — `src/lib/db.ts` throws at import time. Fix `.env` and restart.
- **Magic link never arrives** — if SMTP isn't configured, check the server console. If SMTP is configured, check your provider's logs and `EMAIL_FROM` DNS (SPF/DKIM).
- **Stripe webhook 400** — signature mismatch. Make sure `STRIPE_WEBHOOK_SECRET` matches the one `stripe listen` printed (dev) or the dashboard endpoint secret (prod).
- **Customer paid but no key** — check the `webhook_events` table for their event; check `purchases` for the row; check the server console for the Pool API error.

## Further reading

- [Parent `CLAUDE.md`](../../CLAUDE.md) — kit-wide architecture, engineering principles, SDK invariants
- [`SKILL.md`](../../SKILL.md) — the integration skill (paths, DSL grammar, security non-negotiables)
- [`docs/X402-RESELLER-INTEGRATION.md`](../../docs/X402-RESELLER-INTEGRATION.md) — USDC/x402 handler
- **[Wiki](https://github.com/bolivian-peru/proxy-reseller-kit/wiki)** — operational + conceptual docs:
  [Getting Started](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Getting-Started) ·
  [Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation) ·
  [Pak Key Lifecycle](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Pak-Key-Lifecycle) ·
  [Troubleshooting](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Troubleshooting)

## License

MIT.
