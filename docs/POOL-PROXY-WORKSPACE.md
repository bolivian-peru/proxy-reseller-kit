# Build a Pool Proxy page in your own product

Use your existing navigation, typography, forms, colours and responsive components.
This guide specifies the behaviour of a customer connection workspace; it does not
require copying the Proxies.sx page or replacing your application. It covers shared
pool access. An exclusive Private Pool, a device lease, dedicated ports, Private
modem purchases and x402 are separate products and are outside this build.

Checked against this repository's SDK/React **0.15.0** interfaces and the public
stock/pricing responses on **5 November 2026**. Read the
[provider release contract](SHARED-POOL-CONTRACT.md) for lifecycle and session
availability. Repository code, an installed npm version, provider deployment and
successful customer traffic are separate facts. The example below is host-owned
application code, not a new SDK export or a ready-made payment system.

## Page layout

Keep one primary path: **choose stock → configure → generate → test/copy**.
On desktop, place the country grid beside the configuration form. On a phone,
stack them in that order, use a country search sheet if necessary, and keep the
chosen pool/country visible above the Generate button. Avoid overlapping fixed
panels. Put explanations beside the relevant field rather than in a second
competing dashboard.

| Section | What the customer sees | Required behaviour |
| --- | --- | --- |
| Account strip | Raw traffic used / allowance, freshness, credential state | Unknown is not zero; enabled alone is not usable. Show your own retail top-up flow separately. |
| Network selector | All networks / Peer network / Carrier modems | Explicit pool choice; explain the selection in plain language. |
| Country grid | Search, country name/flag, live count, pricing tier | Counts match the chosen pool; keep zero/unknown distinct; never switch a selected country silently. |
| Targeting | Reported IP class, carrier/ISP, optional ASN; city/state where supported | Use live scoped discovery. Classification badges are informational, distinct from selectable controls. |
| Connection form | Protocol, saved SID mode, rotation interval, TTL, optional failover | Show what each setting does; preserve the complete configuration. |
| Output | Copy one, copy all generated, download, Test this selection | Generate from the same saved settings and current customer credential. No provider API key in the browser. |
| Saved lists | Latest 50 on this browser/device, include/exclude, copy, delete | Prefer storing settings/SIDs only. A local deletion or checkbox does not revoke service. |
| Routing sessions | Bounded observed bindings, refresh, conditional release | Label these as bindings, not active connections. Preserve uncertainty and customer ownership. |
| How it works | Connection format, pool selection, targeting and session reference | Link the canonical grammar; use the current selection in examples. |

Your summary might read: “Peer network · United Kingdom · Residential · HTTP ·
Sticky · 10 saved configurations”. “10 configurations” is not ten reserved or
distinct IPs. Stock counts refer to eligible endpoint entries; devices can share
an exit address and supply can change between discovery and connection.

## 1. Pool choice must control both discovery and output

| UI choice | Connection builder `pool` | Carrier/facet discovery `pool` | Meaning |
| --- | --- | --- | --- |
| All networks | `any` (`best` is an alias) | `all` | Intentionally allow either shared network. |
| Peer network | `peer` | `peer` | SDK network with mixed reported classes, including unknown/hosted where advertised. |
| Carrier modems | `mbl` | `mbl` | Shared carrier-modem pool. This selection does not reserve a modem. |

If your existing UI calls the last option **“Private devices”**, add “Shared modem
pool; not reserved” or rename it to “Carrier modems”. Do not confuse that option
with the separate Private Pool product. There is no `private` or `all` connection
pool token. Never pass a discovery value `all` straight to the URL builder.

**Explicitly choose `pool`; do not rely on the SDK's mobile-pool default.**
`buildProxyUrl()` and `PoolPortal` retain `mbl` for compatibility. A PAK with
`qualityTier: 'safe'` forces modem routing; do not advertise peer/all selection
for such a credential. Do not change an existing customer's key quality tier as
a UI repair. Offer only choices compatible with their actual entitlement.

`peer` does not mean residential-only. Residential-only requires
`pool: 'peer', ipType: 'residential'`. Reported IP class is a routing field;
network category/ASN evidence is separate, and neither is a guarantee about an
individual physical device. Show unknown classifications honestly. “All
carriers/ISPs” is an aggregate selector, not an unidentified carrier bucket.

## 2. Live countries, stock and pricing tiers

Fetch `GET /v1/gateway/pool/stock` or `client.pool.getStock()` through your normal
data layer. Use `pools.peer[CC]` / `pools.mbl[CC]`, case-insensitively, for the
chosen scope. All networks sums the two. `connected` and `connectedTotals` are
not sellable stock. Honour `generatedAt`, `stale` and transport errors; retain a
last-known value with a stale label rather than presenting a fresh zero.

Build country cards from the latest response and your app's ISO country-name
catalogue. Search by name and ISO code. Include the currently selected country
even if its count becomes zero, so the user sees why Generate is disabled.
A fresh omitted country in a valid complete stock snapshot has no advertised
stock in that scope. A failed/partial/malformed read is unknown. Provide Retry
and “choose another country”; do not silently widen to `any` or change the pool.

Group or filter cards using `pricing.tiers[].countries` and `defaultTier`, not a
hardcoded country list. A pricing tier is not a quality or speed tier. Do not
call a count a verified throughput/concurrency guarantee. Optional stock-depth
badges are your UI heuristic and must not be presented as a provider SLA.

Poll stock about every 30 seconds, respect caching, pause hidden-tab work where
appropriate and cancel/discard stale responses when a selection changes. The
reference model uses a conservative local 90-second age limit; that is an
example UX threshold, not a provider freshness SLA. Show pending/error states
for initial reads and each dependent picker.

### Raw allowance, weighted account balance and your retail price

These are three different quantities:

1. **Customer PAK allowance:** `trafficCapGB` is cumulative. `trafficUsedMB` is
   raw upload + download bytes / 1024². Raw GB = MB / 1024; one raw GB is 1024 MB.
   Use unrounded raw MB for eligibility. Top-up raises the cap and does not reset
   usage or automatically release a hold.
2. **Reseller account traffic balance:** where country pricing is live, raw
   traffic uses `rawGB × burnRate` of the reseller's GB balance. This weighted
   balance consumption does not multiply the customer's raw PAK allowance.
3. **Your customer's price:** your own tariff/contract. The public `pricePerGB`
   is the platform's list-rate illustration, not your negotiated wholesale cost
   or an instruction to charge your customers that amount.

For illustration only, the public response checked on 5 November had:

| Public tier | Balance consumed per raw GB | Effective platform list price per raw GB |
| --- | --- | --- |
| 1 — Premium | 1 GB | $4.00 |
| 2 — Plus | 0.375 GB | $1.50 |
| 3 — Standard | 0.1875 GB | $0.75 |

#### Selling one GB that burns per country (`capMode: 'balance'`, live since 13 November 2026)

A key's cap can count **balance GB** instead of raw GB. Create or update the key with
`capMode: 'balance'`; the key then burns its cap at each exit country's tier rate, exactly as
your own account balance does. Every key also reports `trafficUsedBalanceMB` (and
`trafficUsedBalanceGB`), and the per-key usage series carries `balanceMB` per day, so you can
bill each customer for the tier they actually used even on raw-capped keys.

| 1 GB of a `balance` key's cap carries | Traffic |
| --- | --- |
| Premium country (burn 1) | 1 GB |
| Plus country (burn 0.375) | 2.67 GB |
| Standard country (burn 0.1875) | 5.33 GB |

Example: you sell your customers one GB at your own Premium price and give each customer a
`balance` key with that many GB. A customer who uses 1 GB in the US, 1 GB in Spain and
1 GB in Mexico uses 1 + 0.375 + 0.1875 = 1.56 GB of their key's cap and the same 1.56 GB of
your balance, so your margin is the same in every country and countries mix freely on one key.
`capMode: 'raw'` (the default) keeps today's behaviour. Burn-weighted counting started on
13 November 2026 (17:29 UTC); usage from before that counts at rate 1 (1 balance GB per GB),
so a key switched to `balance` is never undercounted.

Render the live response instead of copying those numbers into constants. When
`pricing.live` is false, the described balance burn is 1:1; absent or invalid
pricing remains unknown. Volume discounts apply to the amount on a single
eligible purchase as returned in `volumeDiscounts`. Negotiated terms and actual
accounting can differ; an estimate is not a settlement ledger.

A 1 GB customer key can still carry only 1 raw GB even if that traffic consumed
0.375 GB of the reseller balance. Do not show “2.67 GB remaining” on that key by
inverting the burn rate. Keep raw usage history separate from weighted charges;
missing historical coverage is not measured zero. A provider account funding
problem must not tell a customer that their own PAK ran out of GB.

## 3. Targeting and honest availability

| Selection | Discovery | Connection output / limitation |
| --- | --- | --- |
| Country | `getStock()` | Explicit ISO country. No-match remains a refusal. |
| Reported IP class | `stock.ipTypes.peer`, carrier/facet rows | `ipType: mobile / residential / datacenter`; omit for Any class. Unknown is not residential. Modem + non-mobile is unsatisfiable. |
| Carrier/ISP | `getCarrierStock({ country, pool })`, `getFacets({ country, pool, ... })` | Use a supported normalized carrier token or exact ASN; do not send a UI label or facet ID as a routing token. |
| ASN | `carriers[].asns` where supplied; otherwise explicit `asn` | Numeric `asn` hard filter. A merged provider may span multiple ASNs; a dominant ASN is not the whole provider. |
| City | `getCities(country, { pool })` / `getFacets(...)` | Use `cities[].city`, not a translated display name. Matches eligible peers only. |
| State/region | `getFacets(...).states` | Use `states[].state`. Matches eligible peers only. |

City/state can be offered with `peer` and with `any`/`best`, where they narrow
selection to matching **peers**. Modems cannot satisfy them. Disable the controls
for `mbl`; if the customer switches to modems while geo filters exist, explain
the conflict and require an explicit clear/change, rather than dropping tokens
silently. Keep original `any` in generated settings if that is what they chose;
explain that adding geo excludes modems from that configuration.

The current facets request supports `country`, `pool`, `city`, `state` and
`carrier`. It does **not** accept independent `ipType`, `asn` or `isp` query
parameters. Unsupported query fields can be ignored upstream; do not invent
filter support. Echo a facet row's opaque `id` only into the **facet** `carrier`
argument. For routing, use its valid ASN or supported carrier name token.

Feed the current city/state/carrier into the next facet request so choices
narrow each other. The lists deliberately omit their own dimension in some
counts; `facets.total` is not a full country+carrier+ASN+class intersection count.
Positive independent facets cannot establish that all chosen filters coexist.
Keep display counts labelled by their actual scope, and represent an unverified
intersection as unknown until supported evidence or an exact connection test
establishes that one request worked. Do not claim exact available capacity from
`min(cityCount, carrierCount, classCount)`.

Block Generate/Test when current evidence establishes zero for a required
selection. For unknown/stale matching stock, show that state and refresh; do not
promise an available match. An explicitly labelled “export unverified settings”
may be a host product decision, but it must never widen targeting or look like a
successful availability test. Keep the existing saved selection intact.

## 4. Stable configurations, rotation and protocols

Persist complete original settings plus an opaque SID for each logical
configuration: pool, country, class, carrier/ISP/ASN, city/state, protocol,
rotation, TTL and failover. Allocate SIDs with `[a-z0-9_]`, at most 64 characters,
using collision-resistant identifiers. For a durable multi-user product,
allocate/store them server-side with ownership and namespace uniqueness; a
browser list is a convenience copy, not an authorization boundary.

Reuse the same SID for repeated export, Test and reconnect. New logical targeting,
rotation or TTL settings need a new SID/configuration version; a name-only edit
need not. Never reconstruct originals from a session-list URL. Separate SIDs
create separate logical bindings, not guaranteed different IPs. Multiple copies
of one SID share a binding preference, not an immutable exit address.

Timed `auto5/10/20/60` values are **minutes**, evaluated when a later connection
uses the saved SID. Existing sockets are not forcibly rotated at the deadline.
Sticky prefers a binding; endpoint/network changes can change its public IP.
`hard` is a sticky alias, not “new IP per request”. No rotation choice reserves
hardware. TTL is binding lifetime, not a promise about socket duration or IP
stability. See the [single token reference](USERNAME-DSL.md) for advanced tokens,
including failover, strict mode and the separate pinning products. The bare
`strict` flag is meaningful only for sticky/hard, not timed rotation. Disable it
for timed modes and explain the conflict when changing modes; do not save a
setting the builder would silently omit. `failover: strict` is a separate policy.

Generate HTTP on `gw.proxies.sx:7000` and SOCKS5 on `:7001`. HTTPS destinations
use HTTP CONNECT through the HTTP proxy; the example does not claim a TLS-to-proxy
listener. For SOCKS remote DNS, curl uses `socks5h://` or
`--socks5-hostname`; `socks5://` alone in some clients resolves DNS locally.
The SDK 0.15 builder accepts `http` / `socks5` and emits `socks5://`; this does
not configure a consuming tool's DNS behaviour. Configure remote DNS in that
tool, or adapt the URI for a client that supports `socks5h`. Do not pass
`socks5h` to the typed builder as if it were a supported SDK protocol.

Use environment variables or a private credential input for examples, not a
real account/password copied from a screenshot:

```sh
# PROXY_HTTP_URL is the exact selected HTTP export, loaded privately.
curl --max-time 15 --proxy "$PROXY_HTTP_URL" https://your-approved-echo.example/ip
# PROXY_SOCKS5H_URL is the same SOCKS export adapted for curl remote DNS.
curl --max-time 15 --proxy "$PROXY_SOCKS5H_URL" https://your-approved-echo.example/ip
```

Replace the reserved `.example` target with a controlled/approved echo service.
Do not print credentials, persist credential-bearing command history, or publish
observed peer exit addresses in documentation or telemetry.

## 5. Test the current selection, not a different proxy

Neither `createPoolApiHandlers()` nor the SDK 0.15 methods provide a universal
customer “test this proxy” route. A host `POST /api/pool/test` would be **your own
implementation**, not an existing provider API. Do not display a working Test
button until that server route exists and has protocol acceptance tests.

Resolve the authenticated customer's stored PAK on the server; accept a saved
configuration ID/version, not arbitrary reseller credentials, destination URLs
or provider key IDs from the browser. Revalidate the stored settings/ownership
and test the exact pool/country/filters/SID/protocol. Use a fixed approved echo
target with an HTTPS request, bounded timeout and body, no arbitrary redirects,
per-customer limits and secret-free logs. A browser fetch to your API alone does
not prove proxy delivery. Use separate real HTTP CONNECT and SOCKS5 remote-DNS
adapters; if only HTTP is implemented, say “Test HTTP” and do not report SOCKS5
as tested. SOCKS UDP is not implied by SOCKS TCP support.

Return an observed timestamp, tested protocol/configuration version, success,
latency and a safe error category. Count `ok:false` as failure even with HTTP 200.
Classify quota, authentication/disabled/expired key, provider funding, no matching
stock, capacity, destination and transport failures only where structured evidence
supports that distinction. A generic 407 does not uniquely mean “wrong password”.
Keep unknown failures unknown and include a safe correlation ID for support.

The test consumes traffic and can create/refresh that SID's binding. Tell the
customer before it runs. One successful request is not sustained throughput,
customer-network/destination compatibility, a fresh IP, stable session, exact
rotation timing, future stock or an earnings/concurrency guarantee.

## 6. Browser saved lists and current credentials

Use at most **50 latest lists**, newest first. Store a versioned, customer/key
identity-scoped local-storage record containing list ID/name/time, include flag
and complete settings/SIDs. Prefer **no plaintext passwords or full proxy URLs**
in persistent storage. Resolve only the signed-in customer's current secret when
copy/export is requested, with a private no-store response; do not fetch a reseller
account credential into the browser. Clear in-memory secrets on logout/change of
customer and keep other customers' local namespaces inaccessible in the UI.

The [typed example model](examples/pool-workspace/model.ts) demonstrates scope
mapping, country freshness, dynamic burn estimates, whitelisted settings
serialization, latest 50 retention and current-secret export. Its imports use
repository source so fixtures check the real builder. In your application use
`@proxies-sx/pool-sdk` for those imports. It intentionally supplies no auth,
credential persistence, local-storage key, SID allocator, UI or mutation worker;
those belong to your host application. Catch storage/quota/parse failures and
show “Could not save on this device” rather than silently claiming persistence.

“In Copy-all” changes only which locally saved configurations are exported.
Deleting/clearing a list removes this browser's saved settings; old exported URLs
and current connections may continue working. It performs no upstream DELETE,
password regeneration or key disable. Changing a password is a separate
security action with durable mutation recovery; do not promise immediate cache
invalidation or termination of existing tunnels. Generate exports from the
current secret, retaining the intended saved SID/settings.

## 7. Routing sessions are not active connections

Use the authenticated ownership mapping for every session call:

- `GET /v1/gateway/pool/my-sessions?pakId=<owned record id>`;
  SDK `sessions.list({ pakId })`.
- Exact scoped read and generation-conditioned release follow the
  [released binding contract](SHARED-POOL-CONTRACT.md#session-inventory-and-release).
- Keep `truncated`, freshness and errors. Preserve last observed rows on failure;
  empty/partial inventory does not prove no current sockets or URL revocation.

Name the section **Routing sessions** or **Observed bindings**. A binding is not
an open socket and is not a paid reservation. Do not derive concurrent connection
usage from the number of rows. If no authoritative active-connection metric is
available for the customer, show it as unavailable rather than fabricate one.

Release the selected owned binding with its observed generation; check
`success`, handle 409 replacement, and preserve ambiguous outcomes. Never blind
retry after timeout. It leaves existing sockets open and a valid exported URL
can bind again. No “Disconnect all devices” label for `closeAll`. Production
hosts must persist mutation intent/uncertainty beyond a React component's memory.

## 8. Reuse actual React 0.15 interfaces

You can use the supplied components with `classNames`/CSS variables, or reuse the
headless hooks in your own design. Do not create duplicate auth/usage/stock state
when your app already owns it. These signatures exist in 0.15:

```tsx
import {
  usePoolKey, usePoolStock, usePoolCarrierStock, usePoolFacets,
} from '@proxies-sx/pool-portal-react';

// Inside a component/custom hook; chosen values come from your own form state.
const me = usePoolKey('/api/pool');
const stock = usePoolStock('/api/pool', { refreshIntervalMs: 30_000 });
const carriers = usePoolCarrierStock('/api/pool', country, { pool: discoveryPool });
const facets = usePoolFacets('/api/pool', {
  pool: discoveryPool, country, city, state, carrier: selectedFacetCarrierId,
});
```

`discoveryPool` is `peer`, `mbl` or `all`, derived from the same explicit selection
as output. These hooks return `{ data, loading, error, refetch }`; they do not
persist named configurations, implement your Test route or prove combined stock.
Handle out-of-order responses and validate returned scope in the host. The current
facets hook has no separate ASN/IP-class query parameter.

`PoolPortal` accepts explicit `pool`, but no `ipType` prop.
`PoolSessionSpawner` accepts `defaultPool`, stock, carrierStock and facets; it is
not a fully controlled form or a durable configuration store. Its built-in
country reconciliation can select another option as choices change, so a host
requiring strict saved selection should own its form and use the builder/hooks.
`PakQuickstart` and `PoolDocsPanel`'s copyable curl remain fixed to `mbl` in 0.15;
there is no pool prop for those examples. Use your selected configuration for a
peer/all “How it works” example rather than placing an unrelated modem example
beneath it. Never invent component props or claim the new reference model is a
published package export.

Server handlers must resolve `getSessionUserId` and `getUserKeyId` from your own
session/database; the customer cannot choose their provider PAK. The reseller
API key stays server-side. Shared-key read routes require `customers:read`,
mutations `customers:write`, session reads `ports:read`, releases `ports:write`,
aggregate usage `traffic:read`; public stock/incidents need no secret. Expose only
the routes your product needs. See [React handlers](../packages/react/README.md#server-handlers-v040).
Do not enable the starter's live payments without checking its
[documented delivery limits](SHARED-POOL-CONTRACT.md#starter-payment-delivery).

## 9. Acceptance before selling this flow

- Typecheck/build against the exact installed SDK and React versions. Test the
  model with the real builder; do not mock a stronger API than the provider.
- Verify all/peer/mbl, fresh zero versus failed/stale reads, selected country
  disappearing, unsupported combinations, and response races after switching.
- Use two customers under one reseller account: no foreign PAK, saved list,
  session, secret or mutation should be exposed by ID substitution.
- Exercise city/state with peer and any/best; reject modem+geo; test merged
  carrier/ASN selection and unknown category. Never infer an intersection from
  independent counts.
- Assert Tier 2/3 usage leaves raw customer cap unchanged, pricing absent stays
  unknown, and estimates never enter a payment or settlement ledger.
- Real local CONNECT and SOCKS remote-DNS fixtures must test exact saved settings,
  failures, time/body bounds and `ok:false`. Then use a separately authorized QA
  account for limited live acceptance; no automatic free credit or production
  customer mutation.
- Reload saved settings, change current password, exclude/copy/delete lists,
  exceed 50, switch accounts and deny storage. Old list removal must never call
  a provider mutation. New exports must use the current owned credential.
- Observe truncated/error/empty session inventory; release a replaced generation;
  lose the response and restart. Preserve uncertainty instead of another DELETE.
- Check desktop/mobile keyboard navigation, visible selection/error states,
  accessible names and safe copy controls in the actual host design.
- Report source commit, installed versions, test environment, provider release
  and deployed host release separately. A documentation merge does not release
  a customer portal, diagnostic service, payment worker or provider change.

## Agent implementation brief

> Read this guide, `SKILL.md`, `CLAUDE.md`, `USERNAME-DSL.md` and
> `SHARED-POOL-CONTRACT.md`. Inspect the existing app, framework, design system,
> auth/ownership mapping, installed package versions and backend routes before
> editing. Build the shared-pool customer workspace in the host's own style.
> Preserve unrelated products and paid entitlements. Map all/peer/carrier-modem
> choices explicitly; match discovery scope to output. Implement live country
> search/tier grouping, honest stock/freshness, supported targeting, stable saved
> SIDs, bounded actual-protocol diagnostics, latest 50 local settings lists,
> scoped observed sessions and the reference panel. Keep raw customer quota,
> weighted reseller balance and your retail prices separate. Do not invent
> availability, API methods, props, exact-IP promises or revocation guarantees.
> Use the existing builders/hooks where they fit and host-owned controls where
> stricter UX is needed. Preserve current credentials; never send the provider
> API key to the browser. Verify the acceptance cases above and report what is
> source-only, fixture-tested and actually deployed. No unrelated x402/private
> pool work or live financial action is implied by this page build.
