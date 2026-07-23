import type { BuildProxyUrlOpts } from './types';
import { ProxiesConfigError } from './errors';

/** Default Pool Gateway host. Override via {@link ClientConfig.gatewayHost}. */
export const GATEWAY_HOST = 'gw.proxies.sx';

/** HTTP proxy port on {@link GATEWAY_HOST}. */
export const HTTP_PORT = 7000;

/** SOCKS5 proxy port on {@link GATEWAY_HOST}. */
export const SOCKS5_PORT = 7001;

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
 * **IP-stability contract.** Sticky pins the *modem*, not the IP — mobile
 * carrier CGNAT may still re-NAT the exit IP. For an IP that holds across a
 * whole workflow (cf_clearance, banking 2FA), prefer `pool: 'mbl'` with
 * `rotation: 'sticky'` (ultra-stable carrier modems). The `peer` pool is the
 * flagship community network (mixed mobile + residential across 80+ countries);
 * its residential IPs hold longer, but per-endpoint reliability varies, so for a
 * guaranteed held IP a dedicated modem is the strongest option.
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
 * @param proxyUsername Your reseller identifier, e.g. `psx_abc123`.
 * @param pakKey        Customer's Pool Access Key, e.g. `pak_...`.
 * @param opts          Optional tokens — country, rotation, etc.
 * @returns A complete proxy URL suitable for `curl --proxy`, Python `requests`, etc.
 */
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
  if (!/^[a-z0-9_]{1,64}$/.test(sid)) {
    throw new ProxiesConfigError(
      `buildProxyUrl: invalid sid ${JSON.stringify(sid)} — a session id must be 1–64 ` +
        `characters of lowercase letters, digits, or underscores ([a-z0-9_]) and cannot ` +
        `contain a hyphen. Use a stable per-customer id such as "cust_8f3a21bd".`,
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
    sid,
    rotation,
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
  // Hard IP-class filter (`-iptype-mobile|residential|datacenter`).
  if (ipType) tokens.push('iptype', ipType);
  if (city) tokens.push('city', slugToken(city));
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
  // `samecountry` is the gateway default — only emit `-failover-` when overriding.
  if (failover && failover !== 'samecountry') tokens.push('failover', failover);
  // Pin consumes the next two parts server-side: `-pin-<type>-<id>`.
  if (pin) tokens.push('pin', pin.type, pin.id);
  // Session-row TTL, clamped to the gateway's accepted range [60, 2_592_000].
  if (ttl !== undefined) {
    const clampedTtl = Math.min(2_592_000, Math.max(60, Math.round(ttl)));
    tokens.push('ttl', String(clampedTtl));
  }

  const user = `${proxyUsername}-${tokens.join('-')}`;
  const port = protocol === 'socks5' ? SOCKS5_PORT : HTTP_PORT;

  // Encode credentials so user-supplied sid (which may contain symbols) never
  // breaks the URL. Both halves must be encoded per RFC 3986 userinfo rules.
  return `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(pakKey)}@${host}:${port}`;
}
