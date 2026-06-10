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
 * **`sid` rule (sticky session id):** must be **8–64 characters**, lowercase
 * letters / digits / underscore (`[a-z0-9_]`), and not a predictable value
 * (plain sequential numbers and prefixes like `test`/`demo`/`admin`/`user` are
 * rejected). Use your customer's stable id, e.g. `cust_8f3a21bd`. Shorter or
 * predictable sids are rejected by the gateway with `E_USERNAME_PARSE`.
 *
 * **Stickiness needs a sid.** `sticky` / `sticky-strict` / `auto*` only persist
 * across connections when you pass a stable `sid` — it is the session's "port
 * name". Without one, every connection starts a fresh session and you get a
 * new endpoint. Always pass the SAME `sid` for requests that should share an IP.
 *
 * **IP-stability contract.** Sticky pins the *modem*, not the IP — mobile
 * carrier CGNAT may still re-NAT the exit IP. For an IP that holds across a
 * whole workflow (cf_clearance, banking 2FA), prefer `pool: 'mbl'` with
 * `rotation: 'sticky-strict'` (reliable production modems — the recommended
 * default). The residential `peer` pool holds an IP longer but is community-tier
 * so reliability varies; a dedicated modem is the strongest option.
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
 *   rotation: 'sticky-strict',
 * });
 * // → "http://psx_abc123-peer-us-sid-alice_session1-rot-sticky-strict:pak_...@gw.proxies.sx:7000"
 * // (peer = community network: real mobile + residential home IPs)
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
    city,
    sid,
    rotation,
    pool = 'mbl',
    protocol = 'http',
    host = GATEWAY_HOST,
  } = opts;

  const tokens: string[] = [pool];
  if (country) tokens.push(country);
  if (carrier) tokens.push('carrier', carrier);
  // Hard carrier targeting (peer pool). `isp` is a slugified prefix match
  // against the endpoint's ISP name; `asn` is an exact AS-number match. Both
  // are honored by the gateway selector — use these (not the soft `carrier`)
  // when you need to pin a specific carrier, e.g. `isp: 'tmobile'` or
  // `asn: 21928`. Live per-carrier stock: `client.pool.getCarrierStock(cc)`.
  if (isp) tokens.push('isp', isp);
  if (asn) tokens.push('asn', String(asn));
  if (city) tokens.push('city', city);
  if (sid) tokens.push('sid', sid);
  if (rotation) tokens.push('rot', rotation);

  const user = `${proxyUsername}-${tokens.join('-')}`;
  const port = protocol === 'socks5' ? SOCKS5_PORT : HTTP_PORT;

  // Encode credentials so user-supplied sid (which may contain symbols) never
  // breaks the URL. Both halves must be encoded per RFC 3986 userinfo rules.
  return `${protocol}://${encodeURIComponent(user)}:${encodeURIComponent(pakKey)}@${host}:${port}`;
}
