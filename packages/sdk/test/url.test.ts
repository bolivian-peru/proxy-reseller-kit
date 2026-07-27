import { describe, it, expect } from 'vitest';
import { buildProxyUrl, HTTP_PORT, SOCKS5_PORT, GATEWAY_HOST } from '../src/url';
import { ProxiesConfigError } from '../src/errors';

describe('buildProxyUrl', () => {
  const USER = 'psx_abc123';
  const KEY = 'pak_000000000000000000000001';

  it('builds the simplest URL (no tokens → default mbl pool, HTTP)', () => {
    expect(buildProxyUrl(USER, KEY)).toBe(
      `http://psx_abc123-mbl:pak_000000000000000000000001@${GATEWAY_HOST}:${HTTP_PORT}`,
    );
  });

  it('encodes country + rotation + sid in the username', () => {
    expect(buildProxyUrl(USER, KEY, { country: 'us', rotation: 'sticky', sid: 'alice_session1' })).toBe(
      `http://psx_abc123-mbl-us-sid-alice_session1-rot-sticky:pak_000000000000000000000001@${GATEWAY_HOST}:${HTTP_PORT}`,
    );
  });

  it('uses SOCKS5 port when protocol is socks5', () => {
    expect(buildProxyUrl(USER, KEY, { protocol: 'socks5' })).toBe(
      `socks5://psx_abc123-mbl:pak_000000000000000000000001@${GATEWAY_HOST}:${SOCKS5_PORT}`,
    );
  });

  it('supports the peer pool', () => {
    expect(buildProxyUrl(USER, KEY, { pool: 'peer', country: 'de' })).toBe(
      `http://psx_abc123-peer-de:pak_000000000000000000000001@${GATEWAY_HOST}:${HTTP_PORT}`,
    );
  });

  it('appends carrier and city when provided', () => {
    const url = buildProxyUrl(USER, KEY, {
      country: 'us',
      carrier: 'att',
      city: 'nyc',
    });
    expect(url).toContain('-mbl-us-carrier-att-city-nyc');
  });

  it('appends a hard ASN filter (peer carrier targeting)', () => {
    const url = buildProxyUrl(USER, KEY, { pool: 'peer', country: 'us', asn: 21928 });
    expect(url).toContain('psx_abc123-peer-us-asn-21928');
  });

  it('appends a hard ISP slug filter', () => {
    const url = buildProxyUrl(USER, KEY, { pool: 'peer', country: 'us', isp: 'tmobile' });
    expect(url).toContain('-peer-us-isp-tmobile');
  });

  it('omits the asn token when asn is 0 or undefined', () => {
    expect(buildProxyUrl(USER, KEY, { country: 'us' })).not.toContain('-asn-');
    expect(buildProxyUrl(USER, KEY, { country: 'us', asn: 0 })).not.toContain('-asn-');
  });

  it('rejects an invalid sid at build time (fail fast, not a runtime CONNECT 400)', () => {
    // The gateway lowercases the username and splits it on '-', so a sid with a
    // hyphen / uppercase / punctuation / >64 chars never forms a valid session.
    // Surface it here instead of letting the URL die mid-request.
    expect(() => buildProxyUrl(USER, KEY, { sid: 'user@example.com' })).toThrow(ProxiesConfigError);
    expect(() => buildProxyUrl(USER, KEY, { sid: 'has-hyphen' })).toThrow(ProxiesConfigError);
    expect(() => buildProxyUrl(USER, KEY, { sid: 'UpperCase' })).toThrow(ProxiesConfigError);
    expect(() => buildProxyUrl(USER, KEY, { sid: 'x'.repeat(65) })).toThrow(ProxiesConfigError);
  });

  it('accepts short / underscore sids (Atheris -sid- regression fix)', () => {
    // `t1` previously built a URL that 400'd at CONNECT because the old gateway
    // enforced an 8-char minimum. Both SDK and self-healing gateway now accept it.
    expect(buildProxyUrl(USER, KEY, { sid: 't1' })).toContain('-sid-t1');
    expect(buildProxyUrl(USER, KEY, { sid: 'cust_8f3a21bd' })).toContain('-sid-cust_8f3a21bd');
  });

  it('URL-encodes pak_ with special characters (defensive)', () => {
    const weirdKey = 'pak_abc:def@ghi';
    const url = buildProxyUrl(USER, weirdKey, { country: 'us' });
    expect(url).toContain(encodeURIComponent(weirdKey));
    expect(() => new URL(url)).not.toThrow();
  });

  it('honors a custom host', () => {
    const url = buildProxyUrl(USER, KEY, { host: 'edge-eu.proxies.sx' });
    expect(url).toContain('@edge-eu.proxies.sx:7000');
  });

  it.each(['auto5', 'auto20', 'auto60', 'ondemand', 'sticky', 'hard'] as const)(
    'accepts rotation mode %s',
    (rotation) => {
      const url = buildProxyUrl(USER, KEY, { rotation });
      expect(url).toContain(`-rot-${rotation}`);
    },
  );

  it("skips the rot token for 'none' and 'auto10' (the gateway default)", () => {
    // A literal -rot-none / -rot-auto10 is a token the gateway doesn't
    // recognize — mirror PoolSessionSpawner's skip logic and emit nothing.
    expect(buildProxyUrl(USER, KEY, { rotation: 'none' })).not.toContain('-rot-');
    expect(buildProxyUrl(USER, KEY, { rotation: 'auto10' })).not.toContain('-rot-');
  });

  it('emits -failover only when overriding the samecountry default', () => {
    expect(buildProxyUrl(USER, KEY, { failover: 'samecountry' })).not.toContain('-failover-');
    expect(buildProxyUrl(USER, KEY, { country: 'us', failover: 'strict' })).toContain(
      '-failover-strict',
    );
  });

  it('emits -ttl clamped to the gateway range [60, 2592000]', () => {
    expect(buildProxyUrl(USER, KEY, { ttl: 3600 })).toContain('-ttl-3600');
    // Below floor clamps up to 60, above ceiling clamps down to 2592000.
    expect(buildProxyUrl(USER, KEY, { ttl: 5 })).toContain('-ttl-60');
    expect(buildProxyUrl(USER, KEY, { ttl: 9_999_999 })).toContain('-ttl-2592000');
  });

  it('emits -iptype for the hard IP-class filter', () => {
    expect(buildProxyUrl(USER, KEY, { country: 'us', ipType: 'residential' })).toContain(
      '-iptype-residential',
    );
  });

  it('emits -pin-<type>-<id> for a device/port pin', () => {
    expect(buildProxyUrl(USER, KEY, { pin: { type: 'device', id: 'abc123' } })).toContain(
      '-pin-device-abc123',
    );
    expect(buildProxyUrl(USER, KEY, { pin: { type: 'port', id: 'p42' } })).toContain(
      '-pin-port-p42',
    );
  });

  it('emits the bare strict token under sticky / hard pinning', () => {
    // `strict` carries no value — the gateway reads it as a single token and
    // applies a hard ipStabilityScore floor on top of sticky selection.
    expect(buildProxyUrl(USER, KEY, { rotation: 'sticky', strict: true })).toContain(
      '-rot-sticky-strict',
    );
    expect(buildProxyUrl(USER, KEY, { rotation: 'hard', strict: true })).toContain(
      '-rot-hard-strict',
    );
  });

  it.each(['none', 'auto5', 'auto10', 'auto20', 'auto60', 'ondemand'] as const)(
    'silently skips strict under rotation %s (gateway only honors it while pinned)',
    (rotation) => {
      expect(buildProxyUrl(USER, KEY, { rotation, strict: true })).not.toContain('-strict');
    },
  );

  it('silently skips strict when no rotation is given (gateway default is auto10)', () => {
    // No -rot- token means the gateway applies auto10, which is not a pinning
    // mode — emitting strict there is noise, not an error.
    expect(buildProxyUrl(USER, KEY, { strict: true })).not.toContain('-strict');
    expect(buildProxyUrl(USER, KEY, { strict: false, rotation: 'sticky' })).not.toContain(
      '-strict',
    );
  });

  it("keeps strict and failover:'strict' as separate tokens", () => {
    // Two different features that happen to share a word: the bare `strict`
    // token tightens endpoint selection, `-failover-strict` disables substitution.
    const url = buildProxyUrl(USER, KEY, {
      country: 'us',
      rotation: 'sticky',
      strict: true,
      failover: 'strict',
    });
    expect(url).toContain('-rot-sticky-strict-failover-strict');
  });

  it('emits -pin-lease-<id> for a Reserved IP lease', () => {
    expect(buildProxyUrl(USER, KEY, { country: 'us', pin: { type: 'lease', id: 'l23d4e83c5b' } })).toContain(
      '-pin-lease-l23d4e83c5b',
    );
  });

  it('rejects a pin id the gateway would read raw and fail to resolve', () => {
    // The pin id is the one DSL value the gateway does NOT sanitize, and an
    // unresolvable pin falls through to shared selection with no error — so a
    // bad id must fail here, loudly, instead of silently downgrading the route.
    expect(() => buildProxyUrl(USER, KEY, { pin: { type: 'device', id: 'has-hyphen' } })).toThrow(
      ProxiesConfigError,
    );
    expect(() => buildProxyUrl(USER, KEY, { pin: { type: 'port', id: 'UpperCase' } })).toThrow(
      ProxiesConfigError,
    );
    expect(() => buildProxyUrl(USER, KEY, { pin: { type: 'device', id: '' } })).toThrow(
      ProxiesConfigError,
    );
    expect(() =>
      buildProxyUrl(USER, KEY, { pin: { type: 'device', id: 'x'.repeat(65) } }),
    ).toThrow(ProxiesConfigError);
  });

  it('rejects a lease id that does not match the gateway lease shape', () => {
    // Gateway: /^l[a-z0-9]{8,12}$/ — anything else resolves to no endpoint.
    expect(() => buildProxyUrl(USER, KEY, { pin: { type: 'lease', id: 'abc123def' } })).toThrow(
      ProxiesConfigError,
    );
    expect(() => buildProxyUrl(USER, KEY, { pin: { type: 'lease', id: 'l1234567' } })).toThrow(
      ProxiesConfigError,
    );
    expect(() =>
      buildProxyUrl(USER, KEY, { pin: { type: 'lease', id: `l${'a'.repeat(13)}` } }),
    ).toThrow(ProxiesConfigError);
    expect(() => buildProxyUrl(USER, KEY, { pin: { type: 'lease', id: 'l23d4e83c5b_' } })).toThrow(
      ProxiesConfigError,
    );
  });

  it('accepts the lease shape at both length bounds', () => {
    expect(buildProxyUrl(USER, KEY, { pin: { type: 'lease', id: `l${'a'.repeat(8)}` } })).toContain(
      '-pin-lease-laaaaaaaa',
    );
    expect(buildProxyUrl(USER, KEY, { pin: { type: 'lease', id: `l${'a'.repeat(12)}` } })).toContain(
      '-pin-lease-laaaaaaaaaaaa',
    );
  });

  it('throws ProxiesConfigError on missing proxyUsername', () => {
    expect(() => buildProxyUrl('', KEY)).toThrow(ProxiesConfigError);
  });

  it('throws ProxiesConfigError on missing pakKey', () => {
    expect(() => buildProxyUrl(USER, '')).toThrow(ProxiesConfigError);
  });
});
