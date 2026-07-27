# @proxies-sx/pool-portal-react

[![npm](https://img.shields.io/npm/v/@proxies-sx/pool-portal-react)](https://www.npmjs.com/package/@proxies-sx/pool-portal-react)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](../../LICENSE)

> Drop-in React component and headless hooks for embedding a **[Proxies.sx Pool Gateway](https://client.proxies.sx/pool-proxy)** reseller dashboard into any React app. Ships with a Next.js API route factory so you can wire it up in five minutes without reinventing the backend.

---

## Install

```bash
npm install @proxies-sx/pool-portal-react @proxies-sx/pool-sdk
```

Peer deps: React 18+, React-DOM 18+.

Optional default styles:

```ts
import '@proxies-sx/pool-portal-react/styles.css';
```

---

## 5-minute quickstart (Next.js App Router)

### 1. Wire up the API route

Create `app/api/pool/[...path]/route.ts`:

```ts
import { createPoolApiHandlers } from '@proxies-sx/pool-portal-react/server';
import { ProxiesClient } from '@proxies-sx/pool-sdk';
import { auth } from '@/lib/auth';           // your auth lib (Clerk/NextAuth/…)
import { db } from '@/lib/db';               // your DB

export const { GET, POST } = createPoolApiHandlers({
  proxies: new ProxiesClient({
    apiKey: process.env.PROXIES_SX_API_KEY!,
    proxyUsername: process.env.PROXIES_SX_USERNAME!,
  }),
  getSessionUserId: async () => (await auth())?.userId ?? null,
  getUserKeyId: async (userId) => {
    const customer = await db.customers.get(userId);
    return customer?.pakKeyId ?? null;
  },
});
```

### 2. Drop the component into any page

```tsx
// app/dashboard/page.tsx
import { PoolPortal } from '@proxies-sx/pool-portal-react';
import '@proxies-sx/pool-portal-react/styles.css';

export default function Dashboard() {
  return (
    <PoolPortal
      apiRoute="/api/pool"
      branding={{ name: 'AcmeProxies', primaryColor: '#6366f1' }}
    />
  );
}
```

That's the whole integration. The browser **never** sees your `PROXIES_SX_API_KEY` — all calls flow through your own API route.

---

## How auth works

```
Customer's browser
      │ (signed-in session via your auth lib)
      ▼
<PoolPortal apiRoute="/api/pool" />
      │ fetch("/api/pool/me", { credentials: 'same-origin' })
      ▼
createPoolApiHandlers()  (your /api/pool/[...path]/route.ts)
      │ getSessionUserId() → who is this?
      │ getUserKeyId()     → which pak_ do they own?
      │ proxies.poolKeys.list() → fetch usage from api.proxies.sx
      ▼
Respond with { proxyUsername, pakKey, usage }
```

The component is strictly UI — it knows nothing about `api.proxies.sx`. Your API route is the trust boundary.

---

## `<PoolPortal>` props

| Prop | Type | Default | Description |
|---|---|---|---|
| `apiRoute` | `string` | `"/api/pool"` | Base path of your mounted handlers |
| `pool` | `'mbl' \| 'peer' \| 'any' \| 'best'` | `'mbl'` | Which network the generated username routes to (the first username token). Set `'peer'` to sell the flagship network. **Set this before widening `countries`** — see the note below. |
| `countries` | `Country[]` | `['us','gb','fr','nl','pl','ge']` | Countries the dropdown offers. The default is the **`mbl`** carrier-modem set — exactly those 6. **`ge` is Georgia**, not Germany. |
| `defaultCountry` | `Country` | first in `countries` | |
| `defaultProtocol` | `'http' \| 'socks5'` | `'http'` | |
| `defaultRotation` | `RotationMode` | `'none'` | `'none'` emits **no** `-rot-` token, so the **gateway default `auto10` applies** — a different endpoint roughly every 10 min. It is not "no rotation". Use `'sticky'` (plus a `sid`) to hold a device. |
| `defaultFailover` | `FailoverPolicy` | `'samecountry'` | Failover scope when the exit drops; emits `-failover-<v>` (samecountry omitted). |
| `showStock` | `boolean` | `true` | Show the live-endpoints indicator |
| `showIncidents` | `boolean` | `true` | Show an incident banner when active |
| `showUsage` | `boolean` | `true` | Show the usage bar |
| `branding` | `Branding` | — | `{ name, logoUrl, primaryColor, accentColor, radius, fontFamily }` |
| `classNames` | `PoolPortalClassNames` | — | Per-part className overrides (Tailwind-friendly) |
| `className` | `string` | — | Extra class on the root |
| `style` | `CSSProperties` | — | Inline style on the root |
| `emptyState` | `ReactNode` | — | Rendered when the user has no key yet |
| `onRegenerateKey` | `() => Promise<void>` | — | Called when the user clicks "Regenerate key" |

#### `pool` and `countries` must agree

The two props are coupled, and getting it wrong produces credentials that fail
100% of the time with no client-side error. The generated username is
`psx_<you>-<pool>-<country>-…`, so the country list has to be a list of
countries **that pool actually has stock in**:

- `pool="mbl"` (default) — carrier modems in exactly **6** countries:
  `us`, `gb`, `fr`, `nl`, `pl`, `ge`. Adding anything else mints a username the
  gateway cannot fill. The classic trap is `de`: `mbl-de` has **no stock** and
  always fails, and `ge` is **Georgia**, not Germany.
- `pool="peer"` — the flagship network, ~82–120 countries. This is the setting
  to change when you want a wide country list; widening `countries` on its own
  leaves the pool token at `mbl` and every extra country breaks.

Pull the live country list from `GET /v1/gateway/pool/stock` (exposed by
`createPoolApiHandlers()` as `/stock`, and typed as `client.pool.getStock()`)
rather than hardcoding one — stock moves.

### Branding

```tsx
<PoolPortal
  branding={{
    name: 'AcmeProxies',
    logoUrl: '/logo.svg',
    primaryColor: '#7c3aed',
    accentColor: '#10b981',
    radius: '12px',
    fontFamily: '"Inter", sans-serif',
  }}
/>
```

Brand values map to CSS custom properties (`--psx-primary`, `--psx-accent`, `--psx-radius`, `--psx-font`). Skip `styles.css` and write your own CSS targeting these variables for total control.

### Tailwind users

```tsx
<PoolPortal
  classNames={{
    root: 'w-full max-w-2xl mx-auto',
    card: 'bg-zinc-900 border-zinc-800 text-zinc-50',
    button: 'bg-indigo-500 hover:bg-indigo-600',
    usageBar: 'bg-zinc-800',
  }}
/>
```

Don't import `styles.css` and write everything in Tailwind.

---

## Additional components (v0.4.0+ / v0.4.1+)

Compose with `<PoolPortal>` for full reseller-dashboard parity with `client.proxies.sx/pool-proxy`. All components self-contained, all honor the same `branding` / `classNames` / `style` props.

### `<PoolSessionSpawner>` — multi-port URL generator (v0.4.0+)

```tsx
<PoolSessionSpawner
  proxyUsername={me.proxyUsername}
  proxyPassword={me.pakKey}
  countries={['us', 'gb', 'fr', 'nl', 'pl', 'ge']}
  defaultPool="mbl"
  defaultRotation="sticky"           // gateway smart-picks the most IP-stable modem
  defaultSessionType="unique"        // unique-per-row sids → different modems per row
  onSpawn={(urls) => analytics.track('proxy_spawn', { count: urls.length })}
/>
```

Count slider (1–100), country / pool / protocol / rotation / failover / sid-mode controls, "Generate" → N proxy URLs, per-row Copy + bulk Copy-all + Download .txt. The `showTtlControl` prop (v0.4.2 default true) exposes a "Session TTL override" field that appends `-ttl-<seconds>` to the username DSL (range 60-2592000 = 1 min to 30 days).

**IP class filter (v0.11.0+).** When `pool` is `peer` or `any`, an "IP class" dropdown appears with `Any` / `Mobile only` / `Residential only` / `Datacenter only` — it emits `-iptype-<v>` and hard-filters the peer pool to that verified exit class (unclassified peers are excluded). The `mbl` pool is mobile-only by construction, so the control is hidden whenever `mbl` is selected. Programmatic equivalent: `buildProxyString({ ..., ipType: 'mobile' })`.

Also exports `buildProxyString(opts)` and `defaultTtlSecondsForRotation(rotation)` helpers for hand-rolled UIs. `buildProxyString`'s `ipType?: 'mobile' | 'residential' | 'datacenter'` option is available regardless of whether you use the built-in dropdown.

**Session-type semantics** (the `sessionType` prop / `-sid-` token behavior):

| `sessionType` | Per-row behavior | When N spawned URLs are used |
|---|---|---|
| `unique` | Each row gets its own random `-sid-<prefix><index>` | N different modems (one per row) — best for parallel workers that each want their own stable IP |
| `same` | All rows share the same `-sid-<prefix>` | All rows land on the SAME modem — useful when many parallel sockets from one customer should share one exit |
| `none` | Each row gets a random `-sid-<row-specific>` | Same as `unique` in practice — every row distinct (we always emit a sid; "none" just means "you didn't pick a prefix") |

**Sticky semantics:** with `defaultRotation="sticky"` or `"hard"` the gateway weights IP-stability when picking each row's device — you get the devices whose carrier holds an egress IP best. `hard` **pins like sticky**; it is not "a new IP per request". Two caveats worth surfacing in your own UI copy:

- **Sticky pins the DEVICE, not the IP.** Mobile CGNAT can re-NAT a held modem. For a held address prefer `defaultPool="peer"` (home/ISP peers hold for hours-to-days), or lease a [Reserved IP](../../docs/RESERVED-IPS.md).
- **Stickiness needs a `-sid-`.** The spawner always emits one, so its output is fine — but a hand-built string with `-rot-sticky` and no `-sid-` starts a fresh session on every connection and looks broken.

Full token semantics, including which filters silently widen when nothing matches: [`docs/USERNAME-DSL.md`](../../docs/USERNAME-DSL.md). Layer-1-vs-Layer-2 explanation: [wiki page](https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation).

### `<ActiveSessionsTable>` — live session manager (v0.4.0+)

> ⚠️ **Multi-tenant note.** Since 0.6.0 the `/my-sessions` routes this table polls
> are scoped per-customer (the auto-handlers thread the caller's `pakId` via
> `getUserKeyId`), so it is safe in customer dashboards. On the legacy 0.5.x SDK
> those routes returned ALL account sessions - if you are pinned to 0.5.x, mount
> this only in a single-tenant/admin context, or upgrade.

```tsx
<ActiveSessionsTable
  apiRoute="/api/pool"
  proxyPassword={me.pakKey}
  refreshIntervalMs={5_000}
  onSessionClosed={(key) => toast.success(`Closed ${key.slice(-12)}`)}
/>
```

Polls `GET /api/pool/my-sessions` (auto-handler) at 5 s default. Per-row: country, sid, IP, rotation, TTL countdown, bytes in/out, request count, Copy-URL (with password substitution), Close. Header Close-all + Refresh. Hides synthesized-sid sessions by default (`hideSynthesizedSessions`).

### `<PoolDocsPanel>` — drop-in technical reference (v0.4.1+)

```tsx
<PoolDocsPanel
  proxyUsername={me.proxyUsername}
  exampleSamplePassword={me.pakKey ?? '<YOUR_PASSWORD>'}
/>
```

Four collapsible sections: how-it-works flow (5-step request lifecycle), username token reference (full DSL grammar), IP rotation modes (with TTL table), example curl (parametrized by your username). Pure presentational. Pass `sections={['tokens', 'rotation']}` to render only specific blocks.

### `<PoolStockGrid>` — live country stock (v0.4.1+)

```tsx
<PoolStockGrid
  apiRoute="/api/pool"
  countries={['us', 'gb', 'fr', 'nl', 'pl', 'ge']}
  variant="grid"               // or 'compact' for one-line-per-country
  refreshIntervalMs={30_000}
/>
```

Live online endpoint counts per country for both the `mbl` mobile-modem pool and the `peer` community network. **Country stock differs per pool** — a country may have modems but no peers (or vice-versa); filter your picker by the selected pool. Auto-polls `/api/pool/stock` every 30 s (matches server-side cache TTL). Health pills: green ≥ 5 endpoints, amber < 5.

### `<PrivatePoolPanel>` — branded Private Pool layout (v0.10.0+)

A drop-in layout for selling a **Private Pool** product: a header (pool name +
quality-tier badge + optional usage bar) over the same `<PoolSessionSpawner>`
customers already use.

```tsx
import { PrivatePoolPanel } from '@proxies-sx/pool-portal-react';

<PrivatePoolPanel
  proxyUsername={proxyUsername} // REQUIRED — your psx_ reseller username (the USERNAME half)
  pak={customer.pak}            // the pak_ key, minted server-side with qualityTier (the PASSWORD half)
  qualityTier="safe"            // 'safe' → "Dedicated modems"; 'standard' → "Modems + peer · auto-failover"
  label="Acme Private Pool"
  usedGB={customer.usedGB}      // pass with capGB to render a usage bar
  capGB={100}
  deviceCount={20}              // optional subtitle
  apiRoute="/api/pool"
  countries={['us', 'gb', 'fr', 'nl', 'pl', 'ge']}
/>
```

`PrivatePoolPanel` extends `PoolSessionSpawnerProps` (minus `proxyPassword`,
which it supplies from `pak`), so **`proxyUsername` is required** — omit it and
TypeScript fails the build with `TS2741`. It is your reseller `proxyUsername`
(`psx_…` from the `client.proxies.sx` dashboard), never the `psx_` API key.
The panel emits `psx_<you>-…` as the username and the `pak_` as the password.

Mint the key **server-side** (the reseller API key must never reach the browser)
with `proxies.poolKeys.create({ qualityTier: 'safe', trafficCapGB: 100, … })` —
see the SDK README's "Private Pool — quality tier" section — then pass `key.key`
as `pak`. `'safe'` gives a dedicated, modem-only allocation; `'standard'` routes
across modems + verified peers with automatic failover.

### Server handlers (v0.4.0+)

`createPoolApiHandlers()` exports three methods. `GET` (`/me`, `/stock`,
`/stock/carriers`, `/incidents`, `/my-sessions`) and `POST` (`/regenerate`) and
`DELETE` (`/my-sessions`):

| Method | Path | Action | Scoped to caller? |
|---|---|---|---|
| `GET` | `<route>/me` | Current user's `pak_` + usage | ✅ via `getUserKeyId` |
| `GET` | `<route>/stock` | Live per-country endpoint counts | n/a (public stock data) |
| `GET` | `<route>/stock/carriers` | Per-carrier stock for a country (v0.9.0) | n/a (public stock data) |
| `GET` | `<route>/incidents` | Status-page incidents | n/a |
| `POST` | `<route>/regenerate` | Rotate current user's key | ✅ via `getUserKeyId` |
| `GET` | `<route>/my-sessions` | List sessions | ✅ since 0.6.0 via `getUserKeyId` → `pakId` (⚠️ 0.5.x returned all account sessions) |
| `DELETE` | `<route>/my-sessions/<sessionKey>` | Close one | ✅ since 0.6.0 (⚠️ 0.5.x: any key under the account) |
| `DELETE` | `<route>/my-sessions` | Close all | ✅ since 0.6.0 (⚠️ 0.5.x: every account session) |

`export const { GET, POST, DELETE } = createPoolApiHandlers({...})`.

#### Session routes — multi-tenant security

Every route above is scoped to the caller via `getUserKeyId`, including
`/my-sessions`: since **0.6.0** the handlers thread the caller's `pakId` into
`sessions.list({ pakId })` / `close(key, { pakId })` / `closeAll({ pakId })`,
and `ActiveSession` carries `pakKeyId`. Mounting them on a multi-tenant customer
dashboard is safe.

> ⚠️ **Only if you are pinned to the legacy `0.5.x` packages:** those session
> routes took no arguments and operated across **every** session under your
> `psx_` API key, so any signed-in customer could list, close, or wipe another
> customer's sessions by calling the route directly. The fix is to upgrade —
> `npm i @proxies-sx/pool-portal-react@latest` — not to work around it. Confirm
> with `npm view @proxies-sx/pool-portal-react version`.

---

## Headless hooks

Prefer to build your own UI? Use the same data layer:

```tsx
import { usePoolKey, usePoolStock, useIncidents, buildProxyUrl } from '@proxies-sx/pool-portal-react';

function MyDashboard() {
  const me = usePoolKey('/api/pool');
  const stock = usePoolStock('/api/pool');
  const incidents = useIncidents('/api/pool');

  if (me.loading) return <Spinner />;
  if (me.error || !me.data) return <ErrorView onRetry={me.refetch} />;

  const url = buildProxyUrl(me.data.proxyUsername, me.data.pakKey, {
    country: 'us',
    rotation: 'sticky',
  });
  return <MyCustomUI url={url} usage={me.data.usage} stock={stock.data} />;
}
```

All hooks return `{ data, loading, error, refetch }`. `usePoolStock` and `useIncidents` poll every 30s/60s respectively; override with `{ refreshIntervalMs }`.

**`usePoolCarrierStock(apiRoute, country, { refreshIntervalMs? })`** (v0.9.0) - per-carrier
endpoint counts for one country, backed by `GET <route>/stock/carriers?country=<cc>`.
Polls every 30s. Use it to populate a carrier picker next to `<PoolSessionSpawner>`'s
carrier/ASN controls.

### `<PakQuickstart>` - one-key onboarding card (v0.6.0+)

Shows a customer THEIR key with a copy-ready proxy string, country dropdown, and an
optional usage meter. Props: `proxyUsername` (**required**), `pak` (required),
`secret?` (omit to render a `<YOUR_PASSWORD>` placeholder - safest default),
`secretDisplay?: 'masked' | 'plain'`, `defaultCountry?`, `gatewayHost?`, plus
cap/used GB for the meter.

```tsx
<PakQuickstart
  proxyUsername={me.data.proxyUsername}
  pak={me.data.pakKey}
  defaultCountry="us"
/>
```

`proxyUsername` is what makes the rendered credential correct: it goes in the
**username** field (`psx_<you>-<pool>-<cc>`) and the `pak` goes in the
**password** field. `createPoolApiHandlers()`'s `/me` returns `proxyUsername`
alongside `pakKey`, so both come from the same call.

---

## Server API reference

The route table lives in one place — see
[Server handlers](#server-handlers-v040) above for every path, method, and
scoping guarantee.

### Options

| Option | Required | Description |
|---|---|---|
| `proxies` | ✅ | `ProxiesClient` instance |
| `getSessionUserId(req)` | ✅ | `string \| null` — who is making this request? |
| `getUserKeyId(userId)` | ✅ | `string \| null` — which `pakKeyId` belongs to this user? |
| `gatewayHost` | | Passed through to the browser for custom edge deployments |
| `onAudit(event)` | | Called on writes (e.g. regenerate). Log to your audit trail. |

### Provisioning a key for a new customer

`createPoolApiHandlers` only reads existing keys. Create them server-side after a successful payment:

```ts
// app/api/stripe/webhook/route.ts
import { ProxiesClient } from '@proxies-sx/pool-sdk';

const proxies = new ProxiesClient({
  apiKey: process.env.PROXIES_SX_API_KEY!,
  proxyUsername: process.env.PROXIES_SX_USERNAME!,
});

// On `checkout.session.completed`:
const key = await proxies.poolKeys.create({
  label: `customer:${session.customer}`,
  trafficCapGB: Number(session.metadata?.gb),
  // Optional: 60-day expiry. Top-ups extend it via poolKeys.topUp() (preferred over update).
  expiresAt: new Date(Date.now() + 60 * 86_400_000).toISOString(),
  idempotencyKey: `mint_${session.id}`,        // SDK ≥ 0.3.0 — protect against double-mint on retry
});
await db.customers.update(customerId, { pakKeyId: key.id });

// On subsequent top-ups, prefer topUp() over update() — atomic + idempotent.
await proxies.poolKeys.topUp(key.id, {
  addTrafficGB: 10,                            // server-side $inc, race-safe
  extendDays: 60,                              // pushes expiresAt forward
  idempotencyKey: `topup_${invoiceId}`,
});
```

### Time-bounded credits in the dashboard (v0.2.0+)

If you mint keys with `expiresAt`, surface it in your `/api/pool/me` response so `<PoolPortal />` can render the countdown banner automatically:

```ts
// In your /me handler, return the key's expiresAt + isExpired
return NextResponse.json({
  proxyUsername: process.env.PROXIES_SX_USERNAME!,
  pakKey: key.key,
  pakKeyId: key.id,
  usage: {
    usedMB: key.trafficUsedMB,
    usedGB: (key.trafficUsedMB / 1024),
    capGB: key.trafficCapGB,
    enabled: key.enabled,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,    // ISO string or null
    isExpired: key.isExpired,    // server-computed
  },
});
```

`<PoolPortal />` will then render:

- **> 7 days remaining** → small dim line "Expires Aug 30, 2026 (88 days remaining)"
- **≤ 7 days** → amber banner "Credits expire in N days. Top up to extend."
- **Past expiry** → red banner "Credits expired. Top up to reactivate."

Customers whose key has an expiry will see the countdown; those without an expiry see nothing extra.

---

## Security

- Your `PROXIES_SX_API_KEY` lives **only on the server**. The component never sees it.
- `pak_` keys are only sent to the customer they belong to (enforced by your `getSessionUserId` + `getUserKeyId`).
- If a `pak_` leaks, the user can hit `POST /api/pool/regenerate` (wired to `onRegenerateKey`) to rotate it. The platform invalidates the old secret at once, but the gateway caches auth for **up to 30 s**, so the leaked value can still open new connections for that long — and tunnels already open are not torn down. Rotation is a ~30 s cutoff, not an instant kill. To end it now, also close the sessions (`DELETE /api/pool/my-sessions`).
- `/me` responses are sent with `Cache-Control: private, no-store` so they don't leak via CDN/browser cache.
- Public endpoints (`/stock`, `/incidents`) are cacheable (30s / 60s).

---

## Runtime compatibility

- Works in any React 18+ environment: Next.js App/Pages Router, Vite, Remix, React Router
- Server handlers work on any runtime that supports standard `Request` / `Response` (Node, Vercel Edge, Cloudflare Workers, Deno, Bun)
- ESM + CJS + `.d.ts` types, zero runtime dependencies besides `@proxies-sx/pool-sdk`

---

## License

MIT — see [LICENSE](../../LICENSE).
