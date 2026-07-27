# Migration — DSL completeness release

> Covers the release that closes the gap between what `buildProxyUrl` could
> emit and what the Pool Gateway parser actually accepts, plus the
> documentation correction pass that shipped alongside it. The version number
> is assigned at publish time; check each package's `CHANGELOG.md` for the
> exact tag.

**TL;DR — one line can now throw where it previously didn't.** If you pass
`pin`, read [Breaking: `pin.id` is validated](#breaking-pinid-is-validated).
Everything else is additive.

---

## What changed

### Added — `strict` (bare flag)

`strict` was the only routing behaviour the gateway understood that the SDK
could not express. It is a bare token — no value — and only meaningful
alongside `sticky` or `hard`, where it makes the selector weight IP-stability
much harder and apply a minimum-stability floor.

```ts
buildProxyUrl(proxyUsername, pakKey, {
  pool: 'peer',
  country: 'us',
  sid: 'cust_8f3a21bd',
  rotation: 'sticky',
  strict: true,          // → …-rot-sticky-strict
});
```

A no-op for `auto*` / `ondemand`, exactly as at the gateway.

### Added — `pin.type: 'lease'`

The Reserved-IP pin form. `pin.type` was `'port' | 'device'`; it is now
`'port' | 'device' | 'lease'`.

This one mattered more than it looks. The gateway parser **silently drops a pin
whose type it does not recognise** — no error, no correction visible to the
caller — and the request falls through to ordinary shared selection. A backend
emitting `-pin-lease-` against a client that could not express it would have
produced credentials that quietly routed onto random shared devices while the
customer believed they were on a reserved one.

```ts
buildProxyUrl(proxyUsername, pakKey, {
  pool: 'peer',
  country: 'us',
  sid: 'res01',
  rotation: 'sticky',
  pin: { type: 'lease', id: 'l23d4e83c5b' },
});
```

Prefer `lease` over `device` for anything reserved — see
[`RESERVED-IPS.md`](./RESERVED-IPS.md).

### Breaking — `pin.id` is validated

`pin.id` is now validated and throws `ProxiesConfigError` when it fails.
Previously any string was interpolated straight into the username. Two checks:

| Check | Applies to | Pattern |
|---|---|---|
| DSL token shape | every `pin.type` | `^[a-z0-9_]{1,64}$` — the same charset `sid` uses |
| Lease-id shape | `pin.type: 'lease'` only | `^l[a-z0-9]{8,12}$` — mirrors the gateway's own `LEASE_ID_RE` |

The second check exists because the gateway applies the identical pattern
before it will even look up the lease pointer. An id that fails it resolves to
nothing server-side, so failing at build time costs nothing and saves a silent
mis-route.

**Why this is worth a throw.** `pin.id` is the only value token the gateway
parser does *not* sanitize — it is read raw. A `-` anywhere inside truncates
the token, the pin resolves to nothing, and the connection silently falls
through to shared selection. The customer paid for a specific exit and got a
random one, with a `200` and no signal. There is no runtime error to catch;
build time is the only place this can be surfaced.

**Who is affected:** only callers passing `pin`. If your ids are already
lowercase alphanumerics — which every id the platform emits is — nothing
changes. If you construct ids yourself, normalise before calling:

```ts
// Before — silently produced a broken pin
buildProxyUrl(u, k, { pin: { type: 'device', id: rawId } });

// After — fail fast, or normalise deliberately
const id = rawId.toLowerCase().replace(/[^a-z0-9_]/g, '');
buildProxyUrl(u, k, { pin: { type: 'device', id } });
```

Wrap the call in a `try`/`catch` for `ProxiesConfigError` if you feed it
untrusted input.

### Not changed

`carrier`, `isp`, `asn`, `iptype`, `city`, and `ttl` were **already** emitted by
`buildProxyUrl`. Earlier drafts of the kit's docs implied otherwise; that was a
documentation error, not a missing feature. No code change was needed and none
was made.

---

## Documentation corrections

The token reference used to be copy-pasted into five files, which drifted. It
now lives in one place — [`USERNAME-DSL.md`](./USERNAME-DSL.md) — and the rest
link to it. Corrections made in the same pass, each verified against gateway
source:

| Was documented as | Actually |
|---|---|
| `rotation: 'none'` gives a fresh IP per request | Emits no token, so the **gateway default `auto10`** applies — a different endpoint roughly every 10 min |
| `rot: 'hard'` gives a new IP per request | Pins like `sticky`; at routing time `hard` ≡ `sticky` |
| `-sid-<id>` alone makes a session sticky | A sid without `-rot-sticky` still soft-rotates on the default `auto10`. **Both tokens are required** |
| `sid` = "same exit IP for the session" | Sticky pins the **device**; carrier CGNAT may still re-NAT the address |
| Username format `pak_xxx-mbl-COUNTRY` | The `pak_` is the **password**. Username is `psx_<reseller>-<pool>-<country>-…`; no code path resolves a `pak_` username |
| `mbl` = production/recommended, `peer` = growing/residential | **`peer` is the flagship** (~82–120 countries, mixed mobile + residential); `mbl` is the supportive 6-country carrier-modem tier |
| `ge` (ambiguous) | `ge` is **Georgia**. Germany is `de`, which has **no `mbl` stock** — `mbl-de` always fails |
| `carrier` presented as a filter that is honoured | **Soft.** If it matches nothing the gateway retries without it and serves a different carrier as a `200`. Use `failover: 'samecarrier'` or `'strict'` to make it binding |
| `city` presented as a filter | **Soft** — a ranking bonus only; it never excludes anyone |
| Session routes unscoped, "lock them down until 0.6.x" | Per-customer scoping shipped in **0.6.0** and has been on npm for several releases |

Two facts that were never documented anywhere and now are:

- **TTL is immutable for a live session.** Changing `-ttl-` on an existing
  `sid` does nothing until that row expires, because the gateway re-applies the
  *stored* TTL on every touch. Use a new `sid` to apply a new TTL immediately.
- **Reserved IPs are offline-substitutable by default.** A leased device that
  goes offline is replaced with unreserved shared stock and returns `200`
  unless the lease was acquired with `failover: 'strict'`. See
  [`RESERVED-IPS.md`](./RESERVED-IPS.md).

---

## Upgrade checklist

1. `npm i @proxies-sx/pool-sdk@latest @proxies-sx/pool-portal-react@latest`
2. Search your codebase for `pin:` — confirm every `id` matches
   `^[a-z0-9_]{1,64}$`, or catch `ProxiesConfigError`.
3. Search for `rotation: 'none'`. If the intent was "don't rotate", that is
   `rotation: 'sticky'` plus a stable `sid` — `'none'` gets you `auto10`.
4. Search for any `-sid-` you build by hand without a matching `-rot-`. Add
   `-rot-sticky` if you meant sticky.
5. Search your customer-facing copy for "same IP" next to "sticky" and fix it
   to "same device".
6. Prove it, don't assume it:
   ```bash
   curl -x "http://<username>:<pak>@gw.proxies.sx:7000" https://api.ipify.org
   ```

No server-side migration is required. Existing credentials keep working —
`-pin-device-` remains supported precisely because credentials already in
customers' hands use it.
