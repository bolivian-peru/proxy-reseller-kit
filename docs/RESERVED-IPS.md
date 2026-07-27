# Reserved IPs — exclusively leased devices

A **Reserved IP** is a lease on one specific device. While the lease is live,
that device is held for a single customer: the gateway refuses to serve it to
anyone else, and the customer's credential keeps pointing at it even after the
device is rotated underneath them.

This is the strongest IP-hold the platform offers short of dedicated hardware.
It is the answer to "sticky isn't sticky enough" — see
[the DSL reference](./USERNAME-DSL.md#1-sticky-pins-the-modem-not-the-ip) for
why plain sticky is not that.

> **Status.** Reserved IPs live on the Private Pool product surface
> (`/v1/private-pool/*`), not the reseller `pool-keys` API, and the feature is
> flag-gated on the platform. `@proxies-sx/pool-sdk` does **not** wrap these
> routes — call them with your own HTTP client. Confirm availability for your
> account before you sell it downstream.

---

## How it works

```
POST /v1/private-pool/:poolId/leases
      │  acquire a device matching { country, ipType, carrier }
      ▼
lease  { leaseId: "l23d4e83c5b", … }
      │  the backend writes a pointer:  lease:<leaseId> → endpointId
      ▼
credential embeds  -pin-lease-l23d4e83c5b
      │  the gateway reads the pointer on every connect
      ▼
whichever device the lease holds RIGHT NOW
```

The lease id — not a device id — is what goes in the credential. That
indirection is the whole design: rotating a lease to a different device
rewrites the pointer, so a credential the customer copied once stays correct
forever. A raw `-pin-device-<id>` would silently route onto hardware the lease
no longer reserves.

The generated username looks like this:

```
psx_acme-peer-us-sid-res01-pin-lease-l23d4e83c5b-rot-sticky
```

`-rot-sticky` is always emitted, and `-failover-<policy>` is appended whenever
the lease's failover policy is anything other than the `samecountry` default.

---

## The caveat that matters most: offline devices are substitutable

**A leased device that goes offline does not fail your request — by default it
is replaced with an ordinary, unreserved device from the shared pool, and the
response is a normal `200`.**

The gateway classifies a pin failure into one of five outcomes, and only two of
them are allowed to substitute:

| Outcome | What happened | Substitutes? |
|---|---|---|
| `honored` | Lease resolved, owned by this customer, device online | — served |
| `unavailable` | The leased device exists but is **offline** | **YES**, unless `failover: strict` |
| `missing` | No such endpoint (device deregistered entirely) | **YES**, unless `failover: strict` |
| `released` | The lease expired or was released | No — **fails closed** |
| `taken` | Held by a different customer, or at its customer cap | No — **fails closed** |

So the expiry case is safe: when a lease ends, the customer gets a clean error
rather than a quiet downgrade onto shared stock. The *offline* case is not.

**Sell it accordingly.** A customer paying for a reserved IP almost always means
"this exact exit or nothing" — which is `failover: 'strict'`, not the default:

```jsonc
POST /v1/private-pool/:poolId/leases
{
  "country": "us",
  "ipType": "residential",
  "failover": "strict"      // ← fail closed instead of silently substituting
}
```

With `strict`, an offline reserved device returns a gateway error the customer
can retry or alert on. Without it, they get someone else's IP and no signal at
all — the exact failure a reserved IP was bought to prevent.

If a customer *does* want graceful degradation, leave the default and tell them
explicitly that substitution can happen, so a mismatched exit is not read as a
bug later.

---

## Lifecycle

All routes are under `https://api.proxies.sx/v1/private-pool` and authenticate
with either a JWT or a `psx_` API key (`JwtOrApiKeyAuthGuard`). Every lease is
scoped to the calling user's own pool. Traced to
`src/private-pool/private-pool.controller.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/:poolId/leases` | List this pool's reserved IPs |
| `POST` | `/:poolId/leases` | Acquire one. Body: `country`, `ipType?`, `carrier?`, `idleTtlSec?`, `failover?` |
| `POST` | `/leases/:leaseId/rotate` | Move the lease to a different device in the same country, now |
| `POST` | `/leases/:leaseId/extend` | Change the idle keep-window |
| `DELETE` | `/leases/:leaseId` | Release back to the pool |
| `PATCH` | `/leases/:leaseId/rotation-mode` | `off` (hold — the default) or `auto5`/`auto10`/`auto20`/`auto60` |
| `POST` | `/leases/:leaseId/rotation-token` | Issue or regenerate a public rotate link (old link stops working) |
| `DELETE` | `/leases/:leaseId/rotation-token` | Revoke that link |

Rate limits observed in the controller: acquire 20/min, rotate 10/min. Rotation
also carries a per-lease hourly budget — exceeding it returns `409` with a
"rotated too many times in the last hour" message.

### Idle window

A lease is held while it is *in use* and for `idleTtlSec` after the last byte.
The ceiling is **12 hours**. If a customer's workload pauses longer than the
window, the lease lapses and the device returns to the shared pool — and
because a lapsed lease is `released`, their credential then fails closed rather
than silently routing elsewhere. That is the correct behaviour, but it will
read as an outage to a customer who was not told about the window. Set
`idleTtlSec` to cover their real duty cycle.

### Rotation

Two independent controls, easy to confuse:

- **`rotation-mode` on the lease** — `off` by default, meaning *hold this
  device*. Set `auto5`…`auto60` to have the lease periodically move to a
  different device while in use.
- **`POST /leases/:leaseId/rotate`** — move to a different device right now.
  Same country, ~10 s cooldown, hourly budget.

Both change the *device*, and therefore the exit IP. Neither performs a
carrier-level IP reset on a peer device: peers do not expose one. For a modem,
a true carrier IP reset is a separate ProxySmart action, not this route.

The `-rot-sticky` token inside the credential is unrelated to either — it is
gateway routing behaviour, and the lease pin already pins harder than sticky
does.

---

## Reselling it

Reserved IPs are the natural top of a reseller ladder:

| Tier | Product | IP behaviour |
|---|---|---|
| Entry | Shared pool `pak_` | Rotates; `sticky` holds a device, carrier may re-NAT |
| Mid | Shared pool + `-rot-sticky-strict` | Held device, stability-floored selection |
| Top | **Reserved IP** | Exclusively leased device, held across rotations |

Because leases sit on the Private Pool surface rather than the self-serve
pool-keys API, treat this as a **quote / provisioned** tier rather than an
instant-checkout SKU. Collect country, IP class, and expected concurrency, then
provision leases against your own pool and hand the customer the generated
credential.

Traffic bills exactly like the shared pool — **$4.00/GB, discounted to
$2.40/GB on a single order of 250 GB+, duration free** — from the same GB
balance. Anything above that is your retail margin.

The discount tier is set by the quantity on **one purchase**, not by a monthly
running total (`VOLUME_DISCOUNTS` in `src/billing/slot-tier.service.ts` —
"based on single purchase quantity"). Topping up 10 GB at a time all month
earns **0%** every time, so a lease priced against an assumed 40% monthly tier
loses the difference on every GB. Full table:
[`PRIVATE-POOL.md`](./PRIVATE-POOL.md#pricing).

### Honesty rules

These are not style preferences; breaking them generates refunds.

- **Never print, log, or display a peer exit IP.** Availability is counts per
  country, always. IP-reputation vendors scrape exposed inventories and
  pre-blacklist them, which poisons the pool for every customer on it.
- **A lease reserves a device, not an address.** A mobile carrier can still
  re-NAT a held modem. Residential peers hold addresses far longer, which is
  why `ipType: 'residential'` is usually the right choice for a Reserved IP
  sold on IP-hold.
- **Do not describe committed peer capacity as "exclusive hardware."**
  Exclusivity is what a *lease* gives you, per device. See
  [`PRIVATE-POOL.md`](./PRIVATE-POOL.md) for the broader Private Pool product.
- **Say the offline caveat out loud** before a customer discovers it in
  production.

---

## Verify a reserved credential actually routes

Same proof as any other credential — see
[Verify it works](./USERNAME-DSL.md#verify-it-works):

```bash
curl -x "http://<username>:<pak>@gw.proxies.sx:7000" https://api.ipify.org
```

Then confirm the *hold* by repeating it. With a live lease you should keep
landing on the same device. If the address changes, check in this order:

1. Is the lease still live? A lapsed lease fails closed — you would be seeing
   an error, not a different IP.
2. Was `failover: strict` set? If not, a brief device outage substitutes an
   unreserved endpoint and returns `200`. **This is the usual answer.**
3. Neither? Then it is carrier CGNAT re-NATting a held device — expected on
   mobile, rare on residential.
