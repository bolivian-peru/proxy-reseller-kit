# x402 for resellers — accept USDC, mint a `pak_`, return a proxy

This is how you turn your reseller deployment into an **x402 paid proxy endpoint** —
an AI agent sends a request, gets a `402 Payment Required` with your USDC wallet,
pays on-chain, retries with the tx hash, and gets back proxy credentials. You
keep the margin between what you charge the agent and what you pay
proxies.sx for the bandwidth.

The whole integration is ~80 lines of route handler. You do NOT need to run a
chain node, an x402 facilitator, or any payment-verification infrastructure —
the public Coinbase facilitator does that.

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
    │  signs USDC tx to <your_wallet>             ┌─────────────────┐
    │ ──────────────────────────────────────────► │ Base / Solana   │
    │                                              └─────────────────┘
    │  GET /buy + Payment-Signature: 0xtx…
    │ ──────────────────────────────────────────►┌────────────────────┐
    │                                             │ Your handler:      │
    │                                             │  1. POST verify    │ ────► x402.org/facilitator
    │                                             │     (Coinbase)     │ ◄────  { valid, payer, amount }
    │                                             │  2. proxies.poolKeys│
    │                                             │     .create({       │ ────► api.proxies.sx
    │                                             │       trafficCapGB, │ ◄────  pak_xxxx
    │                                             │       idempotency:tx│
    │                                             │       expiresAt })  │
    │                                             │  3. return creds    │
    │ ◄──────────────────────────────────────────│                    │
    │  { proxyUrl: "http://psx_xxx-mbl-us:pak_xxx@proxy.yourbrand.com:7000" }
    ▼
```

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
const DEFAULT_SESSION_GB = 0.1;       // min purchase
const DEFAULT_TTL_SECONDS = 3600;     // 1 hour proxy session
const RECIPIENTS = {
  base:   { address: '0xYOUR_BASE_WALLET',   network: 'base',   chainId: 8453, usdc: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' },
  solana: { address: 'YOUR_SOLANA_WALLET',   network: 'solana', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
};
const FACILITATOR = 'https://x402.org/facilitator';

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const country = (url.searchParams.get('country') ?? 'us').toLowerCase();
  const gb = Number(url.searchParams.get('gb') ?? DEFAULT_SESSION_GB);
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

  // Payment claimed → verify with the public Coinbase facilitator.
  // The facilitator confirms the tx on-chain, returns {valid, payer, amount, network}.
  const verify = await fetch(`${FACILITATOR}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature: paymentSig }),
  }).then((r) => r.json() as Promise<{ valid: boolean; payer?: string; amount?: string; network?: string; reason?: string }>);

  if (!verify.valid) {
    return Response.json({ error: 'Payment verification failed', reason: verify.reason }, { status: 402 });
  }

  const paidMicro = parseInt(verify.amount ?? '0', 10);
  // Allow a 2% tolerance for gas / quote drift (matches platform behavior).
  if (paidMicro < Math.floor(parseInt(amountMicro, 10) * 0.98)) {
    return Response.json({ error: 'Insufficient payment' }, { status: 402 });
  }

  // Mint a pak_ scoped to THIS payment. txHash as idempotencyKey means a
  // retried request returns the same pak (no double-mint) — critical because
  // agents WILL retry on network blips.
  const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString();
  const key = await proxies.poolKeys.create({
    label:          `x402:${verify.payer ?? 'unknown'}:${paymentSig.slice(0, 10)}`,
    trafficCapGB:   gb,
    expiresAt,
    idempotencyKey: paymentSig,   // tx hash → safe to retry
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
    network:    verify.network,
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
curl 'https://api.yourbrand.com/api/x402-proxy?country=us&gb=0.1'
# → 402 + JSON with payTo / amount / asset

# 2. (Agent's wallet signs a USDC transfer to your address, gets a tx hash)

# 3. Retry with the tx hash.
curl 'https://api.yourbrand.com/api/x402-proxy?country=us&gb=0.1' \
  -H "Payment-Signature: 0xtx_hash_here"
# → 200 + { proxyUrl, pakKeyId, expiresAt, trafficGB }

# 4. Use the returned proxy URL until expiresAt.
curl -x 'http://psx_xxx-mbl-us:pak_xxx@proxy.yourbrand.com:7000' https://api.ipify.org
```

The same pak_ works for the whole window. Sticky / rotation / `-sid-` /
white-label hostname all work exactly like with API-key-minted paks — because
under the hood, it IS one.

---

## Security model

- **Your `psx_` key stays server-side.** Same rule as everywhere else in the kit.
- **`Payment-Signature` is the tx hash — verifiable on-chain.** No need to trust the agent.
- **`idempotencyKey: txHash` blocks double-mint** when an agent retries. Platform
  dedupes within 24h.
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
| $8.00 | $4.00 | $4.00 (50%) | Premium positioning |

USDC settles in ~2s (Base) or ~400ms (Solana). You collect on-chain, the
platform debits your `psx_` account balance via the pak's traffic cap as the
agent uses it. **As long as your `PRICE_PER_GB_USDC > $4`, you're profitable.**

---

## Optional: shipping this as a kit helper

The pattern above is stable enough to wrap as a single `createX402PaidProxyHandler({...})`
factory in `@proxies-sx/pool-portal-react/server`, alongside the existing
`createPoolApiHandlers`. Targeting `0.7.0`. Until then, copy-paste the route
above into your app — it's the canonical implementation.

---

## See also

- The platform's own x402 endpoint: `https://agents.proxies.sx` (`/.well-known/x402.json`
  for the public discovery doc, `https://api.proxies.sx/v1/x402/proxy` for the live endpoint).
- The published x402 SDK packages — `@proxies-sx/x402-core`, `@proxies-sx/x402-hono`,
  `@proxies-sx/x402-solana` — for hand-rolled Express/Hono/Fastify integrations.
- The [x402 protocol spec](https://x402.org).
