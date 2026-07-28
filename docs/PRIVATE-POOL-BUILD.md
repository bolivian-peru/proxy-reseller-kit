# Building your own Private Pool product

[`PRIVATE-POOL.md`](./PRIVATE-POOL.md) explains what Private Pool *is* and how to
sell it. This guide is the other half: **how to re-create the
[client.proxies.sx/private-pool](https://client.proxies.sx/private-pool) page and
system inside your own app**, so your customers buy a dedicated pool from *you*
without ever seeing Proxies.sx.

Read the first section before writing any code. It is short, and it is the
difference between a product that behaves the way you described it to a customer
and one that quietly doesn't.

---

## 1. The mental model: a Private Pool is assembled, not requested

There is no `POST /private-pool` in the reseller API, and you are not missing an
endpoint. A Private Pool is a **product you assemble from three primitives you
already have**:

| # | Primitive | Where it lives |
|---|---|---|
| 1 | A capped `pak_` key, one per customer | Platform — `client.poolKeys.create()` |
| 2 | Connection strings scoped to countries/carriers | Your app — `buildProxyUrl()` |
| 3 | The "pool" concept itself (label, size, term, price) | **Your database** |

The platform stores #1. You store #2 and #3. That is the whole architecture, and
it is exactly how our own page works — `client.proxies.sx/private-pool` writes a
`PrivatePool` row in our DB and mints a pak alongside it.

So the honest framing for an AI agent building this: **you are building a
subscription product whose fulfilment artifact is a capped proxy credential.**
The proxy plumbing is solved. The product is yours.

---

## 2. What the platform enforces vs. what is yours to honour

This is the most important table in this document. Get it wrong and you will
promise a customer something the gateway does not implement.

| What you sell | Enforced by | Real? |
|---|---|---|
| **GB cap** per customer | Platform — auto-suspends at `trafficUsedMB/1024 >= trafficCapGB` | ✅ **Hard** |
| **Expiry** | Platform — checked inline on every auth | ✅ **Hard** |
| **On/off kill switch** | Platform — `enabled: false` | ✅ **Hard** |
| **Modem-only tier** (`qualityTier: 'safe'`) | Platform — gateway rewrites `peer-*` → `mbl-*` | ✅ **Hard** |
| **Reserved IP** (`-pin-lease-`) | Platform — `gw:lease:<id>` → endpoint | ✅ Hard, but **not in the reseller API** (§6) |
| **Country scoping** ("US + GB only") | *The strings you generate.* Nothing at routing time | ⚠️ **Advisory** |
| **Carrier / city / ipType** | Same — token in the string | ⚠️ **Advisory** |
| **Pool size** ("50 dedicated devices") | Nobody, at routing time | ⚠️ **Commercial** |

### Why country scoping is advisory

`allowedCountries` is stored on the pool record, and the **gateway never reads
it** — it is not part of the auth response, and no routing code references it.
A customer who edits `-us-` to `-br-` in their connection string gets Brazil.

This is true of our page too; it is a property of the platform, not a gap in
your build. Design for it:

- Generate the strings for your customer; don't ask them to hand-assemble.
- Bill by GB, which *is* enforced — so off-scope routing costs them their own
  quota, not your margin.
- If you need hard isolation, sell `qualityTier: 'safe'` (below), which is the
  one scoping lever the gateway genuinely enforces.

### `qualityTier: 'safe'` is your real premium tier

`'safe'` is server-enforced: the gateway rewrites any `peer-*` request on that
key to `mbl-*`, so the customer only ever routes over production ProxySmart
modems. That is a genuine, verifiable quality guarantee — the closest analogue
to "dedicated modems" available through the reseller API, and worth a real price
premium.

Its cost is coverage: `mbl` is **6 countries — US, GB, FR, NL, PL, GE**, and
**`GE` is Georgia, not Germany**. A `'safe'` key asking for `de` gets nothing.
Sell `'safe'` for stability, `'standard'` for reach.

---

## 3. Your data model

The platform has no table for your pools, so add one. Minimum viable shape:

```ts
interface PrivatePool {
  id: string;
  customerId: string;          // your customer, not a Proxies.sx user
  label: string;               // "Acme — US/GB scraping pool"

  // Fulfilment
  pakId: string;               // from poolKeys.create() — your join key
  pakKey: string;              // ENCRYPTED AT REST. See §7.

  // What you sold (your contract with the customer)
  countries: string[];         // ['us','gb'] — drives string generation
  pool: 'mbl' | 'peer';
  deviceCount: number;         // the number on the invoice
  qualityTier: 'safe' | 'standard';

  // Commercials
  trafficCapGB: number;        // mirrors the pak cap
  reservationFeeCents: number; // your monthly fee
  retailPerGBCents: number;    // your price, not $4
  termEndsAt: Date;

  status: 'pending' | 'active' | 'suspended' | 'expired';
  createdAt: Date;
}
```

Two fields carry the whole design:

- **`pakId`** is the join key to every platform read — usage, audit, sessions.
  Store it on creation; you will need it constantly.
- **`countries` + `pool`** are your *string-generation inputs*. They are the
  product definition, and because the gateway doesn't enforce them (§2), this
  row is the only place that definition exists.

---

## 4. Build it — five steps

### Step 1 — Check live depth before you sell

Do this **first**, at configure time. Selling a 50-device pool in a country with
4 online devices is the single most common way this product generates refunds.

```ts
import { ProxiesClient } from '@proxies-sx/pool-sdk';

const client = new ProxiesClient({ apiKey: process.env.PROXIES_SX_API_KEY! });

// Public, unauthenticated, counts only — never exit IPs.
const stock = await client.pool.getCarrierStock({ country: 'us' });
// { pool, country:'US', total:294, carriers:[{asn,name,ipType,count}, ...] }

if (stock.total < requestedDeviceCount * 2) {
  // Warn, or cap the order. Depth moves hourly — re-check, never cache for long.
}
```

Show `total` per country in the picker. A country with single-digit depth should
be visibly marked "thin", not silently offered.

### Step 2 — Mint the capped key

```ts
const pak = await client.poolKeys.create({
  label: `pool:${pool.id}:${customer.email}`,   // make it greppable
  trafficCapGB: 250,                            // whole number ≥ 1
  qualityTier: 'safe',                          // 'safe' = modem-only (§2)
  expiresAt: pool.termEndsAt.toISOString(),
  idempotencyKey: `pool-create-${pool.id}`,     // tie to YOUR object, not a UUID
});

await db.privatePools.update(pool.id, {
  pakId: pak.id,
  pakKey: encrypt(pak.key),
  status: 'active',
});
```

Three constraints that will 400 you:

- `trafficCapGB` must be a **whole number ≥ 1** (DTO: `@IsInt() @Min(1)`).
  Fractions are rejected for everyone. **1 GB is the smallest sellable slice** —
  if you sell 500 MB packages, track that in your ledger and mint at 1.
- `null` (unlimited) is **partner-only**. Ordinary resellers get
  `400 "An unlimited pool-access-key requires a partner account."`
- The cap ceiling is `RESELLER_MAX_PAK_CAP_GB`, default **1000**.

`idempotencyKey` should be derived from your pool id, not generated at retry
time — that's what makes the 24h platform dedupe actually protect you.

### Step 3 — Generate the customer's proxies

The "devices" a customer sees in their dashboard are **connection strings**. This
is where `countries` and `deviceCount` from your DB become the product.

```ts
import { buildProxyUrl } from '@proxies-sx/pool-sdk';

function generatePoolProxies(pool: PrivatePool, pakKey: string): string[] {
  const urls: string[] = [];

  for (let i = 0; i < pool.deviceCount; i++) {
    const country = pool.countries[i % pool.countries.length];

    urls.push(buildProxyUrl(pool.resellerAccountId, pakKey, {
      pool: pool.pool,
      country,
      sid: `p${pool.id}_${i}`,   // UNIQUE per proxy — this is what separates them
      rotation: 'sticky',        // sticky NEEDS both sid and rotation
      failover: 'samecountry',
      ttl: 86400,                // sticky silently dies at the 1h default
    }));
  }

  return urls;
}
```

**`sid` is what makes these distinct proxies rather than one proxy repeated.**
Each unique `sid` gets its own session and its own pinned device. Same `sid` from
two machines = the same device.

`ttl` matters more than it looks: the session-row default is 3600s, so a sticky
session left idle overnight is gone by morning and the customer reports "my IP
changed". Set it to the length of their workday or longer.

### Step 4 — Usage, top-up, suspend

```ts
// Live usage for the dashboard
const key = await client.poolKeys.get(pool.pakId);
const usedGB = key.trafficUsedMB / 1024;
const pctUsed = (usedGB / key.trafficCapGB) * 100;

// Per-day series for the chart.
// NOTE: not yet wrapped by the SDK — call the endpoint directly.
// Returns { days, series: [{ date, mbIn, mbOut, mb }] }, oldest → newest,
// gap-filled with zeroes so the x-axis is continuous. ?days= up to 365.
// Ownership-scoped: 404s unless the key belongs to you, so it is safe to
// call with an individual customer's keyId.
const res = await fetch(
  `https://api.proxies.sx/v1/reseller/pool-keys/${pool.pakId}/usage?days=30`,
  { headers: { 'X-API-Key': process.env.PROXIES_SX_API_KEY! } },
);
const usage = await res.json();

// Top-up (atomic $inc server-side — never read-modify-write)
await client.poolKeys.topUp(pool.pakId, {
  addTrafficGB: 100,
  idempotencyKey: `topup-${invoice.id}`,
});
```

**The trap:** `topUp()` raises the cap but does **not** re-enable a key the
platform auto-suspended at 100%. You must explicitly re-enable:

```ts
if (!key.enabled) {
  await client.poolKeys.update(pool.pakId, { enabled: true });
}
```

That is deliberate — a leaked key that auto-recovered would defeat the suspend —
but it means "customer paid and still can't connect" is your most likely support
ticket. Re-enable in the same transaction as the top-up.

### Step 5 — Rotate the credential

```ts
const rotated = await client.poolKeys.regenerate(pool.pakId, {
  idempotencyKey: `rotate-${Date.now()}`,
});
await db.privatePools.update(pool.id, { pakKey: encrypt(rotated.key) });
```

The old secret keeps working for **up to 30s** (gateway auth cache), and
in-flight tunnels are **not** torn down. Treat rotation as "stops working within
~30s", never as an instant kill. For a hard stop, also close the sessions:

```ts
await client.sessions.closeAll({ pakId: pool.pakId });
```

---

## 5. The page blueprint

Our `/private-pool` page is two views. Rebuild them in this order — the builder
sells, the dashboard retains.

### View A — the builder (pre-purchase)

| Section | What it does | Don't skip |
|---|---|---|
| Archetype cards | "Held sessions" / "Wide coverage" / "Enterprise" — routes the user to a preset instead of making them understand the DSL | This is the conversion lever. Most buyers cannot self-serve a config. |
| Pool type | Modem (`safe`) vs Peer (`standard`) | State the 6-country limit for modem **here**, not after purchase |
| Country picker | Multi-select, **live depth per country** (Step 1) | Mark thin countries. This is the refund lever. |
| Size slider | Device count | Bound it by live depth |
| Traffic estimate | GB slider → your retail price | Show *your* price, never $4 |
| Summary + CTA | Reservation fee + per-GB + term | — |

### View B — the pool dashboard (post-purchase)

| Section | What it does |
|---|---|
| Identity strip | Label, status, countries, term — one dense row, not a card grid |
| Usage | Used / cap, % bar, days remaining, **ETA to exhaustion** |
| Proxy list | The generated strings, grouped by country, with **Copy all** |
| Format switcher | `user:pass@host:port` / `host:port:user:pass` / curl / Python — buyers paste into different tools |
| Rotation control | Per-proxy sticky/rotating toggle → regenerates that string |
| Top-up | Inline, and **re-enables** (Step 4) |

The single highest-value element is **Copy all** in the customer's preferred
format. A 50-proxy pool copied one line at a time is where the trial dies.

---

## 6. What you cannot build today

**Reserved-IP leases are not in the reseller API.** Lease creation lives on the
customer-scoped `/v1/private-pool/*` surface, which acts on the *calling account*
— there is no reseller route to mint a lease on a customer's behalf.

You *can* emit a lease pin if you somehow hold a lease id
(`buildProxyUrl(..., { pin: { type: 'lease', id } })` is typed and supported),
but you cannot create, rotate, or extend one through the reseller API.

If a customer needs a genuinely held IP, escalate it to us as a custom
allocation rather than approximating it with sticky — sticky pins the *device*,
and the carrier can still re-NAT the exit IP. Promising a held IP on top of
sticky is the fastest way to lose an enterprise customer.

---

## 7. Footguns specific to this build

1. **Never send the `psx_` reseller key to the browser.** Mint server-side. The
   `pak_` is the customer's credential; the `psx_` is yours and controls every
   customer you have.
2. **Encrypt `pakKey` at rest.** You are storing a live billable credential. Log
   it truncated (`pak_...`) or not at all.
3. **Never display or store peer exit IPs.** Availability is counts-per-country
   only. Exit-IP exposure gets the whole fleet IP-reputation-banned — this is a
   platform-wide rule, not a preference.
4. **Don't cache stock.** Depth moves hourly; a cached picker sells countries
   that emptied an hour ago.
5. **`-sid-` alone is not sticky**, and `-rot-sticky` alone does not persist
   across connections. Both. Always.
6. **`ge` is Georgia.** `mbl-de` always fails — Germany must be `peer-de`.
7. **Reconcile nightly.** Your `status` and the pak's `enabled` drift whenever
   the platform auto-suspends. Poll `poolKeys.list()` and reconcile, or your
   dashboard will show "active" on a dead key.

---

## 8. Ship checklist

- [ ] Live depth checked at configure time, thin countries marked
- [ ] Pak minted with a whole-number cap and an idempotency key tied to the pool
- [ ] `pakId` stored; `pakKey` encrypted
- [ ] Strings generated with unique `sid` per proxy, `ttl` ≥ the workday
- [ ] Top-up re-enables the key in the same transaction
- [ ] Copy-all in at least two formats
- [ ] Nightly reconcile of `enabled` / `status`
- [ ] Country scoping described to customers as *configured*, not *enforced*
- [ ] No exit IPs anywhere in the UI, logs, or API responses

---

*See also: [`PRIVATE-POOL.md`](./PRIVATE-POOL.md) (what it is + pricing),
[`RESERVED-IPS.md`](./RESERVED-IPS.md) (lease semantics),
[`USERNAME-DSL.md`](./USERNAME-DSL.md) (the complete token reference — the one
source of truth for routing), and
[`TWO-SIDED-DASHBOARD.md`](./TWO-SIDED-DASHBOARD.md) (admin vs customer split).*
