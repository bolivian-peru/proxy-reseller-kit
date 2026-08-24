import type { BuildProxyUrlOpts, PinConfig } from './types';
import { ProxiesConfigError } from './errors';

/** Default Pool Gateway host. Override via {@link ClientConfig.gatewayHost}. */
export const GATEWAY_HOST = 'gw.proxies.sx';

/** HTTP proxy port on {@link GATEWAY_HOST}. */
export const HTTP_PORT = 7000;

/** SOCKS5 proxy port on {@link GATEWAY_HOST}. */
export const SOCKS5_PORT = 7001;

/**
 * Character rule every id token in the username DSL must satisfy (`sid`,
 * `pin` id). The gateway lowercases the username and splits it on `-`, then
 * keeps only `[a-z0-9_]` per token with a 64-char cap — so anything outside
 * this set is either mangled or mis-tokenized server-side.
 */
const DSL_ID_RE = /^[a-z0-9_]{1,64}$/;

/**
 * Reserved-IP lease id shape, e.g. `l23d4e83c5b`. Mirrors the gateway's own
 * `LEASE_ID_RE` (`gateway/src/redis/endpoint-pool.ts`): a lease pin whose id
 * fails this test resolves to NO endpoint, and the request then falls through
 * to ordinary shared selection instead of erroring.
 */
const LEASE_ID_RE = /^l[a-z0-9]{8,12}$/;

/**
 * Validate a sticky-session id against the gateway's token grammar.
 *
 * The gateway lowercases the proxy username and splits it on `-`, so a sid may
 * only contain `[a-z0-9_]` and must be 1–64 chars. Anything else (uppercase,
 * spaces, a hyphen, punctuation) is silently mangled or mis-tokenized
 * server-side — producing the wrong session, or a CONNECT 400. Surface that at
 * build time with a precise message instead of at runtime.
 */
function validateSid(sid: string): void {
  if (!DSL_ID_RE.test(sid)) {
    throw new ProxiesConfigError(
      `buildProxyUrl: invalid sid ${JSON.stringify(sid)} — a session id must be 1–64 ` +
        `characters of lowercase letters, digits, or underscores ([a-z0-9_]) and cannot ` +
        `contain a hyphen. Use a stable per-customer id such as "cust_8f3a21bd".`,
    );
  }
}

/**
 * Validate a `-pin-<type>-<id>` target.
 *
 * The pin id is the ONE value in the DSL the gateway does not sanitize — it is
 * read raw out of the username. So a hyphen truncates it, and a pin that fails
 * to resolve is NOT an error server-side: the request silently falls through to
 * ordinary shared selection. For a Reserved IP that is worse than no pin at
 * all (the customer pays for a held endpoint and quietly gets a random one), so
 * both failure modes are caught here at build time.
 */
function validatePin(pin: PinConfig): void {
  if (!DSL_ID_RE.test(pin.id)) {
    throw new ProxiesConfigError(
      `buildProxyUrl: invalid pin id ${JSON.stringify(pin.id)} for pin type ` +
        `"${pin.type}" — a pin id must be 1–64 characters of lowercase letters, digits, ` +
        `or underscores ([a-z0-9_]) and cannot contain a hyphen: the gateway reads the ` +
        `pin id raw, so a hyphen splits the token and the pin resolves to nothing — the ` +
        `request then routes to an ordinary shared endpoint with no error. Port/device ` +
        `ids come from support; a Reserved-IP lease id looks like "l23d4e83c5b".`,
    );
  }
  if (pin.type === 'lease' && !LEASE_ID_RE.test(pin.id)) {
    throw new ProxiesConfigError(
      `buildProxyUrl: invalid Reserved-IP lease id ${JSON.stringify(pin.id)} — a lease ` +
        `id is the letter "l" followed by 8–12 lowercase letters or digits, e.g. ` +
        `"l23d4e83c5b". The gateway resolves the lease through its lease→endpoint ` +
        `pointer and returns no endpoint for any other shape, so the pin would silently ` +
        `fall back to shared selection. Use the id from the lease record as-is — do not ` +
        `prefix, truncate, or hyphenate it.`,
    );
  }
}

/**
 * Slugify a free-text DSL value (carrier / isp / city) into a single safe
 * token. The gateway lowercases the whole username, splits on `-`, then keeps
 * only `[a-z0-9_]` per token (max 64). So a value must contain no `-`, space,
 * or punctuation or it mis-tokenizes BEFORE the gateway sanitizes it (e.g.
 * "T-Mobile US" -> would split into "t"/"mobile us"). Matches the spawner's
 * `slugifyDsl`, so both URL builders treat carrier/isp/city identically.
 */
function slugToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 64);
}

/**
 * Build a proxy URL from a reseller `proxyUsername` and a customer `pak_` key.
 *
 * All optional tokens are appended to the username with `-` separators. Pool,
 * country, carrier, sid, and rotation are encoded per the Pool Gateway
 * username DSL — see
 * {@link https://client.proxies.sx/pool-proxy | the public docs}.
 *
 * **`sid` rule (sticky session id):** lowercase letters / digits / underscore
 * only (`[a-z0-9_]`), **1–64 characters**, and it MUST NOT contain a hyphen —
 * the gateway lowercases the username and splits it on `-`, so a hyphen in your
 * sid is mis-tokenized into the wrong session. `buildProxyUrl` validates this
 * and throws {@link ProxiesConfigError} at build time rather than letting you
 * ship a URL that fails at runtime with an opaque CONNECT 400. Use your
 * customer's stable id, e.g. `cust_8f3a21bd`; prefer ≥8 chars of entropy so two
 * different customers never collide on the same session. (The gateway parser is
 * self-healing: it will further sanitize anything that slips through — but the
 * point of the sid is a stable identifier, so don't rely on silent rewriting.)
 *
 * **Stickiness needs a sid.** `sticky` / `auto*` only persist across
 * connections when you pass a stable `sid` — it is the session's "port
 * name". Without one, every connection starts a fresh session and you get a
 * new endpoint. Always pass the SAME `sid` for requests that should share an IP.
 * The token is `sid`, not `session`. `-session-<id>` is silently ignored
 * (unknown token) so you get a fresh synthetic session per connection and no
 * stickiness. Always use `-sid-<id>` (this helper always emits `sid`).
 *
 * **Emission contract — this function is the reference implementation.** Any
 * wrapper that builds a proxy URL (a portal form, a React generator, a CLI)
 * must produce the same token string for the same inputs, so the rules are
 * stated rather than left to be re-derived:
 *
 * - Every routing value you set is emitted. The builder never silently drops
 *   one because it looks redundant for the chosen pool — see `ipType`.
 * - Any **finite** `ttl` is **clamped** into `60..2_592_000` — never dropped
 *   and never thrown on. Dropping it falls back to the gateway default of
 *   3600, which shortens a session the caller explicitly asked to lengthen.
 *   (`NaN` / `Infinity` have no clamp target and emit no token at all.)
 * - `carrier` / `isp` / `city` / `state` are **slugified** to one `[a-z0-9_]`
 *   token, because a raw value like `"T-Mobile US"` would split on its own hyphen.
 * - The only deliberate omissions are the gateway's own defaults —
 *   `rotation: 'none'`, `rotation: 'auto10'`, `failover: 'samecountry'` — plus
 *   `strict` under a rotation mode the gateway would not honor it in.
 * - Only two things throw: `sid` and `pin.id`. Both are validated precisely
 *   *because* the gateway does not fail on them — a mangled sid routes to the
 *   wrong session and an unresolvable pin falls through to shared selection,
 *   with no error either way. Everywhere else, be no stricter than the
 *   self-healing parser.
 *
 * **IP-stability contract.** Sticky pins the *modem*, not the IP — and `hard`
 * is the same thing spelled differently (the gateway maps both to a rotation
 * interval of `0` and routes them down the identical pinned path). Neither
 * holds an IP: mobile carrier CGNAT re-NATs the exit address on its own
 * cadence, so a perfectly-pinned modem still surfaces different IPs. Ranked by
 * how well an IP actually holds:
 *
 * 1. A Reserved IP lease (`pin: { type: 'lease', … }`) — the only held-endpoint
 *    guarantee, and the only thing to sell for cf_clearance / banking 2FA.
 * 2. `pool: 'peer'` residential — real home/ISP IPs, typically hours-to-days.
 *    Per-endpoint reliability varies more than a modem's.
 * 3. `pool: 'mbl'` with `rotation: 'sticky'`, optionally `strict: true` (see
 *    {@link BuildProxyUrlOpts.strict}) — the calmest carrier modem available,
 *    chosen on observed rotation history. Rock-solid *connection*, still
 *    behind carrier CGNAT, still not a held IP.
 *
 * Never promise a customer "the same IP" on the strength of a rotation mode.
 *
 * **Reliability / auto-failover (gateway-side, automatic).** Your customers do
 * not need to handle dead exits. The gateway runs connect-phase auto-failover:
 * if the modem it picks has dropped, that modem is demoted and a healthy one is
 * retried *before any response is returned* — this is what prevents the
 * occasional `503 / temporarily unavailable`. The `failover` token only controls
 * how wide the replacement may be (`samecountry` default … `strict` disables
 * substitution). SOCKS5 (port 7001) additionally falls back to a modem's HTTP
 * CONNECT path (port 7000) if its SOCKS service is briefly down, so both ports
 * are equally reliable — choose with `protocol: 'http' | 'socks5'`.
 *
 * @example
 * ```ts
 * buildProxyUrl('psx_abc123', 'pak_xxxxxxxxxxxxxxxxxxxxxxxx', {
 *   country: 'us',
 *   sid: 'alice_session1',
 *   rotation: 'sticky',
 * });
 * // → "http://psx_abc123-mbl-us-sid-alice_session1-rot-sticky:pak_...@gw.proxies.sx:7000"
 * ```
 *
 * @example Held residential IP (strongest stability):
 * ```ts
 * buildProxyUrl('psx_abc123', 'pak_xxxxxxxxxxxxxxxxxxxxxxxx', {
 *   country: 'us',
 *   pool: 'peer',
 *   sid: 'alice_session1',
 *   rotation: 'sticky',
 * });
 * // → "http://psx_abc123-peer-us-sid-alice_session1-rot-sticky:pak_...@gw.proxies.sx:7000"
 * // (peer = community network: real mobile + residential home IPs)
 * ```
 *
 * @example Strict sticky — only the calmest modems are eligible:
 * ```ts
 * buildProxyUrl('psx_abc123', 'pak_xxxxxxxxxxxxxxxxxxxxxxxx', {
 *   country: 'us',
 *   sid: 'checkout_flow',
 *   rotation: 'sticky',
 *   strict: true,
 * });
 * // → "…-sid-checkout_flow-rot-sticky-strict:pak_...@gw.proxies.sx:7000"
 * // Narrower candidate set: a thin country may return no endpoint.
 * ```
 *
 * @example Reserved IP (Private Pool lease) — the held-endpoint product:
 * ```ts
 * buildProxyUrl('psx_abc123', 'pak_xxxxxxxxxxxxxxxxxxxxxxxx', {
 *   country: 'us',
 *   pin: { type: 'lease', id: 'l23d4e83c5b' },
 * });
 * // → "…-mbl-us-pin-lease-l23d4e83c5b:pak_...@gw.proxies.sx:7000"
 * ```
 *
 * @param proxyUsername Your reseller identifier, e.g. `psx_abc123`.
 * @param pakKey        Customer's Pool Access Key, e.g. `pak_...`.
 * @param opts          Optional tokens — country, rotation, etc.
 * @returns A complete proxy URL suitable for `curl --proxy`, Python `requests`, etc.
 */
export function buildProxyUrl(
  proxyUsername: string,
  pakKey: string,
  opts: BuildProxyUrlOpts = {},
): string {
  if (!proxyUsername) {
    throw new ProxiesConfigError('buildProxyUrl: proxyUsername is required');
  }
  if (!pakKey) {
    throw new ProxiesConfigError('buildProxyUrl: pakKey is required');
  }

  const {
    country,
    carrier,
    isp,
    asn,
    ipType,
    city,
    state,
    sid,
    rotation,
    strict,
    failover,
    ttl,
    pin,
    pool = 'mbl',
    protocol = 'http',
    host = GATEWAY_HOST,
  } = opts;

  const tokens: string[] = [pool];
  if (country) tokens.push(country);
  // carrier / isp / city are free-text — slugify to a single token so a value
  // like "T-Mobile US" cannot split on its own hyphen before the gateway sees it.
  if (carrier) tokens.push('carrier', slugToken(carrier));
  // Hard carrier targeting (peer pool). `isp` is a slugified prefix match
  // against the endpoint's ISP name; `asn` is an exact AS-number match. Both
  // are honored by the gateway selector — use these (not the soft `carrier`)
  // when you need to pin a specific carrier, e.g. `isp: 'tmobile'` or
  // `asn: 21928`. Live per-carrier stock: `client.pool.getCarrierStock(cc)`.
  if (isp) tokens.push('isp', slugToken(isp));
  if (asn) tokens.push('asn', String(asn));
  // Hard IP-class filter (`-iptype-mobile|residential|datacenter`). Emitted
  // for EVERY pool — deliberately not gated on `pool`. Suppressing it for
  // `mbl` (all-mobile by definition) would turn an unsatisfiable request into
  // a silently-different one: `mbl` + `residential` must reach the gateway so
  // it can answer 502 E_NO_STOCK_COUNTRY instead of quietly serving mobile.
  if (ipType) tokens.push('iptype', ipType);
  if (city) tokens.push('city', slugToken(city));
  // `state` is soft and peer-only, same class as `city` — slugified to one
  // token and never gated on pool. On `mbl` the gateway simply has no region
  // data to match, so it widens silently rather than erroring; that is the
  // self-healing behaviour the SDK must not pre-empt by dropping the token.
  if (state) tokens.push('state', slugToken(state));
  if (sid) {
    validateSid(sid);
    tokens.push('sid', sid);
  }
  // Only emit the rot token for a non-default mode. `none` and `auto10` (the
  // gateway default) are skipped — a literal `-rot-none` is a token the
  // gateway doesn't recognize (it heals it away, but the token is noise).
  if (rotation && rotation !== 'none' && rotation !== 'auto10') {
    tokens.push('rot', rotation);
  }
  // `strict` is a BARE token — no value — and the gateway only honors it while
  // an endpoint is pinned (its selector gates strict behind sticky/hard mode).
  // Under any other rotation it is dead weight, so skip it silently rather than
  // throw: the SDK must never be stricter than the self-healing gateway parser.
  // Emitted right after `rot` so the pair reads as `-rot-sticky-strict`.
  if (strict && (rotation === 'sticky' || rotation === 'hard')) {
    tokens.push('strict');
  }
  // `samecountry` is the gateway default — only emit `-failover-` when overriding.
  if (failover && failover !== 'samecountry') tokens.push('failover', failover);
  // Pin consumes the next two parts server-side: `-pin-<type>-<id>`.
  if (pin) {
    validatePin(pin);
    tokens.push('pin', pin.type, pin.id);
  }
  // Session-row TTL, CLAMPED to the gateway's accepted range [60, 2_592_000]
  // — never dropped, never thrown. The gateway clamps to the same bounds and
  // records a correction rather than erroring, so clamping here keeps the two
  // in agreement. Omitting an out-of-range value instead would silently fall
  // back to the gateway default of 3600 and quietly shorten a long session.
  // A non-finite value has no meaningful clamp target and would emit a
  // literal `-ttl-NaN`, so it is skipped (the gateway would default it to
  // 3600 either way — this just keeps the copied credential clean).
  // Immutable once the session row exists — a new `sid` is what changes it.
  if (ttl !== undefined && Number.isFinite(ttl)) {
    const clampedTtl = Math.min(2_592_000, Math.max(60, Math.round(ttl)));
    tokens.push('ttl', String(clampedTtl));
  }

  const user = `${proxyUsername}-${tokens.join('-')}`;
  const port = protocol === 'socks5' ? SOCKS5_PORT : HTTP_PORT;

  // Encode credentials so user-supplied sid (which may contain symbols) never
  // breaks the URL. Both halves must be encoded per RFC 3986 userinfo rules.
  return `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(pakKey)}@${host}:${port}`;
}
