# x402 for resellers — accept USDC, mint a `pak_`, return a proxy

This is how you turn your reseller deployment into an **x402 paid proxy endpoint** —
an AI agent sends a request, gets a `402 Payment Required` with your USDC wallet,
signs a payment authorization, retries with it, and gets back proxy credentials.
You keep the margin between what you charge the agent and what you pay
proxies.sx for the bandwidth.

The whole integration is ~100 lines of route handler. You do NOT need to run a
chain node, an x402 facilitator, or any payment-verification infrastructure —
the public Coinbase facilitator does that.

> ### Verification status of the code below
>
> The facilitator request/response shapes here (`{ payment }` on the wire,
> `{ valid, payment: { payer, amount, network, recipient } }` back, `/settle`
> returning `{ txHash }`) are traced from the platform's own facilitator client,
> `src/x402/x402-facilitator.service.ts` — the same code path that runs
> `api.proxies.sx/v1/x402/proxy` in production. The `poolKeys.create` half is
> traced from `@proxies-sx/pool-sdk` and the platform's pool-keys controller.
>
> **What is not verified:** this exact handler has not been executed end-to-end
> against a live facilitator as written here. Facilitator request shapes also
> vary by vendor and version. Before you take real money with it, run one
> testnet payment through and assert you got a `txHash` back from `/settle` and
> a `pak_` back from the mint. An earlier revision of this file was labelled
> "canonical" while sending `{ signature }` and reading a flat `verify.amount`,
> which 402'd **every valid payment** — a shape error is silent, so smoke-test
> rather than trust the label.

---

## The flow

```
┌────────┐  GET /buy (no payment)  ┌────────┐
│ Agent  │ ──────────────────────► │ Your   │
└────────┘                          │ Next.js│
    ▲                               │  app   │
    │  402 + { payTo: <your_wallet>, amount, asset, network }
    │ ◄─────────────────────────────│        │
    │                               └────────┘
    │  signs a USDC payment payload for <your_wallet>
    │  (base64 — NOT yet broadcast, NOT yet a tx hash)
    │
    │  GET /buy + Payment-Signature: <base64 payload>
    │ ──────────────────────────────────────────►┌────────────────────┐
    │                                             │ Your handler:      │
    │                                             │  1. POST /verify   │ ────► x402.org/facilitator
    │                                             │     {payment}      │ ◄──── { valid, payment:{payer,
    │                                             │                    │         amount, network} }
    │                                             │  2. POST /settle   │ ────► facilitator ─► Base/Solana
    │                                             │     {payment}      │ ◄──── { txHash }   (money moves HERE)
    │                                             │  3. proxies.poolKeys│
    │                                             │     .create({       │ ────► api.proxies.sx
    │                                             │       trafficCapGB, │ ◄────  pak_xxxx
    │                                             │       idempotency:  │
    │                                             │         txHash,     │
    │                                             │       expiresAt })  │
    │                                             │  4. return creds    │
    │ ◄──────────────────────────────────────────│                    │
    │  { proxyUrl: "http://psx_xxx-mbl-us:pak_xxx@proxy.yourbrand.com:7000" }
    ▼
```

> **`verify` alone does not move money.** It only proves the payload is a
> well-formed, funded, correctly-addressed authorization. **`settle` is what
> broadcasts it.** A handler that verifies and mints without settling gives
> away bandwidth for free. Both calls take the *same* base64 payload.

You charge the agent **per GB or per session** in USDC — at whatever margin you
want above the $4/GB we charge you. Reseller economics are entirely yours.

---

## The drop-in (Next.js App Router)

```ts
// app/api/x402-proxy/route.ts
import { ProxiesClient } from '@proxies-sx/pool-sdk';

const proxies = new ProxiesClient({
  apiKey:        process.env.PROXIES_SX_API_KEY!,      // psx_…
  proxyUsername: process.env.PROXIES_SX_USERNAME!,     // psx_xxx
  gatewayHost:   'proxy.yourbrand.com',                // white-label DNS → 46.224.98.3
});

// Your business config: what you charge the agent, your wallet, networks.
const PRICE_PER_GB_USDC = 6.00;       // we charge $4 → you keep $2/GB margin
// `trafficCapGB` is validated `@IsInt() @Min(1)` — a fractional or sub-1 GB cap
// is rejected with a 400 before it reaches any business logic. So the smallest
// sellable unit is 1 GB. If you want to sell smaller slices, sell them in your
// own ledger and still mint the pak at a whole number.
const DEFAULT_SESSION_GB = 1;         // min purchase — must be a whole number >= 1
const DEFAULT_TTL_SECONDS = 3600;     // 1 hour proxy session
const RECIPIENTS = {
  base:   { address: '0xYOUR_BASE_WALLET',   network: 'base',   chainId: 8453, usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  solana: { address: 'YOUR_SOLANA_WALLET',   network: 'solana', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
};
const FACILITATOR = 'https://x402.org/facilitator';

/**
 * Which of your wallets a payment on `network` should have been addressed to.
 * Returns null for a network you don't accept, so the caller rejects it rather
 * than comparing against an empty string that something might match.
 */
function expectedRecipient(network: string): string | null {
  switch (network) {
    case 'base':
      return RECIPIENTS.base.address;
    case 'solana':
      return RECIPIENTS.solana.address;
    default:
      return null;
  }
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const country = (url.searchParams.get('country') ?? 'us').toLowerCase();
  // Coerce to a whole number >= 1 so a `?gb=0.5` query can't 400 the mint.
  const gb = Math.max(1, Math.floor(Number(url.searchParams.get('gb') ?? DEFAULT_SESSION_GB)) || DEFAULT_SESSION_GB);
  const ttlSec = Number(url.searchParams.get('ttl') ?? DEFAULT_TTL_SECONDS);
  const amountUSDC = gb * PRICE_PER_GB_USDC;
  const amountMicro = Math.round(amountUSDC * 1_000_000).toString();

  const paymentSig = req.headers.get('payment-signature') ?? req.headers.get('x-payment-signature');

  // No payment yet → return 402 with terms.
  if (!paymentSig) {
    return Response.json({
      x402Version: 1,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'exact', network: 'base',
          maxAmountRequired: amountMicro, asset: RECIPIENTS.base.usdc,
          payTo: RECIPIENTS.base.address, maxTimeoutSeconds: 60,
          description: `${gb} GB mobile proxy in ${country.toUpperCase()} for ${ttlSec}s — $${amountUSDC.toFixed(2)} USDC`,
        },
        {
          scheme: 'exact', network: 'solana',
          maxAmountRequired: amountMicro, asset: RECIPIENTS.solana.usdc,
          payTo: RECIPIENTS.solana.address, maxTimeoutSeconds: 60,
          description: `${gb} GB mobile proxy in ${country.toUpperCase()} for ${ttlSec}s — $${amountUSDC.toFixed(2)} USDC`,
        },
      ],
    }, { status: 402 });
  }

  // ── 1. VERIFY ────────────────────────────────────────────────────────────
  // The body key is `payment` and the amount comes back NESTED under
  // `payment`, not flat. Getting either wrong is silent: a flat `verify.amount`
  // parses to NaN → 0, so the tolerance check below fails every real payment
  // with a 402 and you never find out why.
  const verify = await fetch(`${FACILITATOR}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment: paymentSig }),
  }).then((r) => r.json() as Promise<{
    valid: boolean;
    error?: string;
    payment?: { payer: string; amount: string; network: string; recipient: string; asset: string };
  }>);

  if (!verify.valid || !verify.payment) {
    return Response.json({ error: 'Payment verification failed', reason: verify.error }, { status: 402 });
  }

  const paidMicro = parseInt(verify.payment.amount, 10);
  // Allow a 2% tolerance for gas / quote drift (matches platform behavior).
  if (!Number.isFinite(paidMicro) || paidMicro < Math.floor(parseInt(amountMicro, 10) * 0.98)) {
    return Response.json({ error: 'Insufficient payment' }, { status: 402 });
  }

  // Verify says "this authorization is good." It does NOT say it is good FOR YOU:
  // a payload signed, funded, and addressed to someone else still returns valid.
  // Confirm the payer is paying you before you settle it.
  const mustPayTo = expectedRecipient(verify.payment.network);
  if (!mustPayTo || verify.payment.recipient?.toLowerCase() !== mustPayTo.toLowerCase()) {
    return Response.json({ error: 'Payment addressed to the wrong recipient' }, { status: 402 });
  }

  // ── 2. SETTLE ────────────────────────────────────────────────────────────
  // THIS is where USDC actually moves. Skip it and you hand out bandwidth for
  // free. Same base64 payload, different endpoint. Returns the on-chain txHash.
  const settle = await fetch(`${FACILITATOR}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payment: paymentSig }),
  });

  if (!settle.ok) {
    return Response.json({ error: 'Payment settlement failed' }, { status: 402 });
  }
  const { txHash } = (await settle.json()) as { txHash: string; network?: string };

  // ── 3. MINT ──────────────────────────────────────────────────────────────
  // The settled txHash is the idempotency key: it is unique per payment and it
  // satisfies the platform's Idempotency-Key rules (8-128 chars, [A-Za-z0-9_-]).
  // Do NOT use `paymentSig` — a base64 payload contains `+ / =` and is usually
  // longer than 128 chars, so the platform rejects it with a 400.
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const key = await proxies.poolKeys.create({
    label:          `x402:${verify.payment.payer}:${txHash.slice(0, 10)}`,
    trafficCapGB:   gb,              // REQUIRED — a positive number. null/omit → 400
    expiresAt,
    idempotencyKey: txHash,          // settled tx hash → safe to retry
  });

  // Build the proxy URL the agent will actually use.
  const proxyUrl = proxies.buildProxyUrl(key.key, {
    country,
    rotation: 'sticky',
    sid: `x402_${key.id.slice(0, 8)}`,
  });

  return Response.json({
    proxyUrl,
    pakKeyId:   key.id,
    expiresAt,
    trafficGB:  gb,
    paidUSDC:   paidMicro / 1_000_000,
    network:    verify.payment.network,
    txHash,                            // the agent's on-chain receipt
  });
}

export async function GET(req: Request)  { return handle(req); }
export async function POST(req: Request) { return handle(req); }
```

That's it. Your endpoint is now a fully-x402-compliant paid proxy.

---

## What the agent sees

```bash
# 1. Ask for a proxy — no payment.
curl 'https://api.yourbrand.com/api/x402-proxy?country=us&gb=1'
# → 402 + JSON with payTo / amount / asset

# 2. (Agent's wallet signs a USDC payment authorization for your address.
#     This is a base64 payload — nothing is on-chain yet, so there is no tx hash.)

# 3. Retry with the signed payload.
curl 'https://api.yourbrand.com/api/x402-proxy?country=us&gb=1' \
  -H "Payment-Signature: <base64_payment_payload>"
# → your handler verifies it, SETTLES it (this is when USDC moves and the
#   txHash comes into existence), then mints
# → 200 + { proxyUrl, pakKeyId, expiresAt, trafficGB, txHash }

# 4. Use the returned proxy URL until expiresAt.
curl -x 'http://psx_xxx-mbl-us:pak_xxx@proxy.yourbrand.com:7000' https://api.ipify.org
```

The same pak_ works for the whole window. Sticky / rotation / `-sid-` /
white-label hostname all work exactly like with API-key-minted paks — because
under the hood, it IS one.

---

## Security model

- **Your `psx_` key stays server-side.** Same rule as everywhere else in the kit.
- **`Payment-Signature` is a signed payment authorization, not a tx hash.** The
  facilitator validates the signature and the funding, so you don't have to trust
  the agent — but validation is not collection. **`/settle` is the collection
  step.** Verify-only handlers give bandwidth away.
- **Check the recipient.** `verify.payment.recipient` must be *your* wallet for
  that network. A payload correctly signed and funded but addressed to someone
  else still verifies as `valid: true`.
- **`idempotencyKey: <settled txHash>` blocks double-mint** when an agent retries.
  Platform dedupes within 24h. The key must be 8-128 chars of `[A-Za-z0-9_-]`;
  a raw base64 payload violates both rules and is rejected with a 400.
- **Settle-then-mint is not atomic.** If `poolKeys.create` fails after a
  successful settle, you have the agent's money and they have nothing. Persist
  `txHash` before minting, and on the retry (same `txHash` → same
  `idempotencyKey`) the mint completes instead of double-charging. Alert on any
  settled `txHash` with no pak after a grace period.
- **`expiresAt` caps your exposure.** If something leaks, the pak dies at the TTL.
  Set it equal to the session you sold.
- **`trafficCapGB` caps the bytes.** Even if expiry is wrong, the agent can't
  use more than they paid for — the platform auto-suspends the pak at the cap.
- **Replay**: the facilitator returns the on-chain `payer` + `amount`; you can
  enforce per-wallet rate limits if you want (track verified txs in your own DB).

---

## Economics

Your margin per session = `(PRICE_PER_GB_USDC - 4) × gb`. Sensible defaults:

| PRICE_PER_GB_USDC | Platform cost | Reseller margin per GB | Notes |
|---|---|---|---|
| $5.00 | $4.00 | $1.00 (20%) | Tight, volume play |
| $6.00 | $4.00 | $2.00 (33%) | Default suggestion |
| $7.00 | $4.00 | $3.00 (43%) | Premium positioning |

The $4/GB platform cost shown here is the standard rate; at scale it is negotiable. A lower negotiated wholesale rate widens every margin row above. Contact admin to arrange volume pricing.

USDC settles in ~2s (Base) or ~400ms (Solana). You collect on-chain, the
platform debits your `psx_` account balance via the pak's traffic cap as the
agent uses it. **As long as your `PRICE_PER_GB_USDC > $4`, you're profitable.**

---

## Optional: shipping this as a kit helper

The pattern above is stable enough to wrap as a single `createX402PaidProxyHandler({...})`
factory in `@proxies-sx/pool-portal-react/server`, alongside the existing
`createPoolApiHandlers`. Targeting `0.7.0`. Until then, copy-paste the route
above into your app — it is the reference implementation, subject to the
[verification note at the top](#verification-status-of-the-code-below): smoke-test
one testnet payment before you point real agents at it.

---

## See also

- The platform's own x402 endpoint: `https://agents.proxies.sx` (`/.well-known/x402.json`
  for the public discovery doc, `https://api.proxies.sx/v1/x402/proxy` for the live endpoint).
- The published x402 SDK packages — `@proxies-sx/x402-core`, `@proxies-sx/x402-hono`,
  `@proxies-sx/x402-solana` — for hand-rolled Express/Hono/Fastify integrations.
- The [x402 protocol spec](https://x402.org).
