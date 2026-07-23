# Private Pool - reserve dedicated capacity

The shared Pool Gateway is first-come, first-served across every online device.
**Private Pool** reserves a private allocation of devices on the *same* gateway, so
a customer gets isolation and predictable capacity instead of competing for the
shared pool. This guide covers what it is, how it is priced, how the request flow
works, and how a reseller offers it to their own customers.

Everything here uses the same endpoint (`gw.proxies.sx:7000` HTTP / `:7001`
SOCKS5), the same `pak_` keys, and the same username DSL you already know - only
the device allocation changes.

---

## When to reach for it

Point a customer at Private Pool when they say any of:

- "I need the same IPs/devices to myself - no neighbours on them."
- "I need guaranteed capacity in country X, not whatever is free right now."
- "I've outgrown the shared pool and want committed supply for a project."
- "I want an enterprise / dedicated tier."

If they just want to start using proxies, the shared pool (self-serve `pak_`
minting) is the right first step - Private Pool is the premium tier on top.

---

## Two pool types

Private Pool comes in two flavours. Both are reserved to one customer, use the
same gateway and DSL, and bill traffic identically - they differ in what is
reserved and how exclusive it can be.

| | `-mbl-` private (Modem pool) | `-peer-` private (Peer network) |
|---|---|---|
| What you reserve | Dedicated 4G/5G mobile modems, **pulled out of the shared pool and exclusively yours** for the term | **Committed capacity** on the peer network - a guaranteed share under your own credentials (community-shared devices, so not locked hardware) |
| Coverage | 6 countries (US, GB, FR, NL, PL, GE) — the curated modem fleet | 80+ countries |
| IP behaviour | Most stable exit behaviour; `-sid-` sticky pins the modem (the carrier may still re-issue the IP) | IPs rotate naturally on the carrier - great when you *want* rotation; no on-command rotation |
| Best for | Held sessions, consistent throughput, full isolation | Wide country reach, high-volume rotating workloads |
| Exclusivity | Full - no other customer routes through your modems | Committed, not exclusive - peers stay part of the shared community network |

**Be honest with customers about the peer type:** a private peer allocation is
*committed capacity*, not reserved hardware. Only the modem pool is pulled out of
the shared pool exclusively. Never promise a peer customer "your own devices no one
else touches" - that is the modem pool.

---

## Pricing

Traffic is priced exactly like the shared pool. The only thing Private Pool adds is
a **monthly reservation fee**.

**Traffic: $4.00/GB base**, with monthly volume discounts, billed only as used from
the same GB balance that covers both pools:

| Monthly volume | Discount | Effective /GB |
|---|---|---|
| 1-24 GB | 0% | $4.00 |
| 25-49 GB | 10% | $3.60 |
| 50-99 GB | 20% | $3.20 |
| 100-249 GB | 30% | $2.80 |
| 250+ GB | 40% | $2.40 |

**Reservation fee: monthly, custom-quoted** per country and pool size. This is the
only Private-Pool-specific cost, and it is confirmed in the quote - requesting a
pool never charges anything.

> Live pricing is always authoritative at [client.proxies.sx](https://client.proxies.sx)
> and [api.proxies.sx/v1/x402/pricing](https://api.proxies.sx/v1/x402/pricing).
> The tiers above mirror the shared-pool volume discounts.

For enterprise volumes, both the reservation fee and the per-GB wholesale rate are negotiable. Request a quote and we will price the whole allocation, traffic included, for your committed volume.

---

## The request flow

Private Pool is **quote-based, not instant checkout** - reserving real devices needs
a live capacity check first. The flow:

1. **Configure** at [client.proxies.sx/private-pool](https://client.proxies.sx/private-pool):
   pool type (modem or peer), pool size (10-200+ devices), countries, term, and an
   expected monthly-GB estimate for the cost preview.
2. **Request** - submitting opens a reservation request. No charge.
3. **We confirm** live availability in the chosen countries and return a quote
   (reservation fee + the standard $4/GB traffic) - usually within one business day.
4. **Provision** - once accepted, the allocation goes live on the same gateway,
   scoped to the customer's credentials.

While the private allocation is being set up, the customer can already use that same
capacity on the shared pool today - the private allocation just makes it exclusively
theirs.

---

## Connecting (username DSL)

Same gateway, same `pak_` key - the pool token selects the network, everything else
in the DSL works scoped to the allocation:

```bash
# Modem pool (dedicated, most stable)
curl -x "http://psx_ACCOUNT-mbl-us-sid-worker01-rot-sticky:pak_KEY@gw.proxies.sx:7000" https://api.ipify.org

# Peer network (wide coverage, rotating mobile IPs)
curl -x "http://psx_ACCOUNT-peer-br-rot-auto10:pak_KEY@gw.proxies.sx:7000" https://api.ipify.org
```

`-sid-<name>` for sticky sessions, `-rot-<mode>` for rotation, `-city-` / `-carrier-`
for soft targeting - all documented in the
[Sticky Sessions and Rotation](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation)
and [Glossary](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Glossary) wiki pages.
(Use `-sid-`, not `-session-` - the latter is not a real token and is silently ignored.)

---

## Offering it as a reseller

Private Pool is your natural **premium / enterprise tier**. Because it is quote-based
rather than self-serve `pak_` minting, you surface it as a **"request a quote" /
"contact us"** action rather than a checkout button:

- Add a "Private Pool / Dedicated capacity" card to your storefront that collects the
  customer's countries, rough pool size, and monthly volume, then relays the request
  to you (or straight to Proxies.sx).
- Use it for customers who outgrow the shared pool, need committed capacity in
  specific countries, or ask for isolation/SLAs.
- Your margin model is the same as the shared pool - you set retail on top of the
  wholesale reservation + $4/GB traffic.

---

## Custom software and flows

Private Pool customers frequently want more than raw proxies. Proxies.sx builds
**custom data-collection software, scrapers, account-management flows, and automated
pipelines** directly on top of a private pool, developed with the customer as they
scale. If a customer's request is really "I need the outcome, not just the IPs,"
flag it with their reservation and it gets scoped alongside the quote.

---

## Honest FAQ

**Is a peer allocation exclusive?** No. Only the modem pool is pulled out of the
shared pool exclusively. A private peer allocation is committed capacity on the
shared community network.

**Will my IP stay fixed?** No. Mobile carriers re-issue IPs on their own schedule.
Sticky pins the *device*, not the IP. For the most stable exit use a dedicated modem
with a sticky session; peer IPs rotate naturally (which many workloads want).

**Are exit IPs shown anywhere?** Never. We report availability as device counts per
country only, and never list exit IP addresses - in the dashboard or anywhere on the
site. This protects the reputation of the reserved pool.

**What if a device goes offline?** For the modem pool, request a replacement in the
same country - your pool size is what you keep. Peer capacity is drawn from the live
community pool, so individual devices come and go by nature.

**How fast to go live?** Availability and pricing are confirmed within about one
business day, then the allocation is provisioned.

---

*See also: [`SKILL.md`](../SKILL.md) (for AI builders) and the
[wiki](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Private-Pool).*
