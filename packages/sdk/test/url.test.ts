import { describe, it, expect } from 'vitest';
import { buildProxyUrl, HTTP_PORT, SOCKS5_PORT, GATEWAY_HOST } from '../src/url';
import { ProxiesConfigError } from '../src/errors';

describe('buildProxyUrl', () => {
  const USER = 'psx_abc123';
  const KEY = 'pak_000000000000000000000001';

  /**
   * Read the emitted `-ttl-<n>` back as a number. A `toContain('-ttl-60')`
   * assertion also matches `-ttl-600`, so the clamp bounds can only be pinned
   * by parsing the value out.
   */
  function emittedTtl(url: string): number | null {
    const match = /-ttl-(\d+)/.exec(url);
    return match ? Number(match[1]) : null;
  }

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

  it('CLAMPS an out-of-range ttl rather than dropping the token', () => {
    // The emission contract: an out-of-range ttl must still reach the gateway
    // as a ttl. Omitting it silently falls back to the gateway default of
    // 3600, so a caller asking for a 30-day session would get a 1-hour one
    // and only find out when their sticky session died overnight. Any wrapper
    // (React generator, portal form) must clamp the same way — this test is
    // the anchor that keeps them from diverging.
    for (const ttl of [0, 1, 59, 2_592_001, 9_999_999, -100]) {
      expect(buildProxyUrl(USER, KEY, { ttl })).toContain('-ttl-');
    }
    expect(buildProxyUrl(USER, KEY, { ttl: 0 })).toContain('-ttl-60');
    expect(buildProxyUrl(USER, KEY, { ttl: -100 })).toContain('-ttl-60');
    expect(buildProxyUrl(USER, KEY, { ttl: 2_592_001 })).toContain('-ttl-2592000');
    // Boundaries pass through untouched.
    expect(buildProxyUrl(USER, KEY, { ttl: 60 })).toContain('-ttl-60');
    expect(buildProxyUrl(USER, KEY, { ttl: 2_592_000 })).toContain('-ttl-2592000');
    // Fractional seconds are rounded, never emitted as a decimal.
    expect(buildProxyUrl(USER, KEY, { ttl: 3600.7 })).toContain('-ttl-3601');
  });

  it('never emits a non-numeric ttl (NaN/Infinity are skipped, not stringified)', () => {
    // `parseInt('', 10)` on an empty form field is the realistic source. The
    // gateway would default a `-ttl-NaN` token to 3600 anyway, so skipping it
    // routes identically and keeps the copied credential clean.
    expect(buildProxyUrl(USER, KEY, { ttl: Number.NaN })).not.toContain('-ttl-');
    expect(buildProxyUrl(USER, KEY, { ttl: Number.POSITIVE_INFINITY })).not.toContain('-ttl-');
  });

  it('emits the exact clamped ttl value, not merely a -ttl- token', () => {
    // The substring assertions above cannot tell `-ttl-60` from `-ttl-600`, so
    // the clamp itself is pinned here by parsing the number back out. This is
    // the reference the React generator and any portal form must match: same
    // input → same integer, always inside [60, 2_592_000].
    const cases: Array<[number, number]> = [
      [-100, 60],
      [0, 60],
      [1, 60],
      [59, 60],
      [60, 60],
      [3600, 3600],
      [3600.4, 3600],
      [3600.7, 3601],
      [86_400, 86_400],
      [2_592_000, 2_592_000],
      [2_592_001, 2_592_000],
      [9_999_999, 2_592_000],
    ];
    for (const [input, expected] of cases) {
      expect(emittedTtl(buildProxyUrl(USER, KEY, { ttl: input }))).toBe(expected);
    }
    // No ttl asked for, and non-finite input, both emit no token at all.
    expect(emittedTtl(buildProxyUrl(USER, KEY))).toBeNull();
    expect(emittedTtl(buildProxyUrl(USER, KEY, { ttl: Number.NaN }))).toBeNull();
  });

  it('clamps ttl identically under every rotation mode', () => {
    // The clamp is a property of the ttl token, not of the routing mode — a
    // wrapper that only clamped for sticky sessions would hand `auto*` callers
    // a silently-defaulted 3600.
    for (const rotation of ['none', 'auto5', 'auto60', 'ondemand', 'sticky', 'hard'] as const) {
      expect(emittedTtl(buildProxyUrl(USER, KEY, { rotation, ttl: 9_999_999 }))).toBe(2_592_000);
      expect(emittedTtl(buildProxyUrl(USER, KEY, { rotation, ttl: 1 }))).toBe(60);
    }
  });

  it('emits -iptype for every pool — never gated on pool', () => {
    // `mbl` endpoints are all mobile, so suppressing the token there looks
    // harmless. It is not: `mbl` + `residential` is unsatisfiable, and the
    // gateway saying so (502 E_NO_STOCK_COUNTRY) is the correct outcome.
    // Dropping the token would hand the caller mobile IPs while they believe
    // they asked for residential.
    expect(buildProxyUrl(USER, KEY, { pool: 'mbl', country: 'us', ipType: 'mobile' })).toContain(
      '-iptype-mobile',
    );
    expect(
      buildProxyUrl(USER, KEY, { pool: 'mbl', country: 'us', ipType: 'residential' }),
    ).toContain('-iptype-residential');
    expect(buildProxyUrl(USER, KEY, { pool: 'any', country: 'us', ipType: 'datacenter' })).toContain(
      '-iptype-datacenter',
    );
  });

  it("builds 'hard' identically to 'sticky' apart from the mode word", () => {
    // `hard` maps to the same rotation interval (0) and the same pinned
    // selection path as `sticky` at the gateway — it is NOT "a fresh TCP
    // connection picks a different modem". Nothing else in the URL may differ,
    // because nothing else in the routing differs.
    const opts = { country: 'us', sid: 'checkout_flow', strict: true } as const;
    const sticky = buildProxyUrl(USER, KEY, { ...opts, rotation: 'sticky' });
    const hard = buildProxyUrl(USER, KEY, { ...opts, rotation: 'hard' });
    expect(hard).toBe(sticky.replace('-rot-sticky', '-rot-hard'));
  });

  it("treats 'hard' as a pinning mode for every gated token", () => {
    // Same gating as sticky: `strict` is emitted, and the sid still rides
    // along (without a sid neither mode persists across connections).
    expect(buildProxyUrl(USER, KEY, { rotation: 'hard', strict: true, sid: 'w1' })).toContain(
      '-sid-w1-rot-hard-strict',
    );
  });

  it("builds 'hard' identically to 'sticky' across the WHOLE token surface", () => {
    // Gateway truth: `hard` and `sticky` both map to rotation interval 0 and
    // take the same pinned path — same stability-weighted selection, same 60s
    // offline-blip grace on session reuse, same exclusion from connect-phase
    // re-selection. So no other token may differ between the two credentials,
    // or the SDK would be encoding routing that does not exist. (The docs used
    // to claim `hard` meant "a fresh TCP connection picks a different modem";
    // if that were true, something here would have to change.)
    const opts = {
      pool: 'peer',
      country: 'us',
      carrier: 'T-Mobile US',
      isp: 'tmobile',
      asn: 21928,
      ipType: 'mobile',
      city: 'nyc',
      sid: 'checkout_flow',
      strict: true,
      failover: 'samenode',
      pin: { type: 'device', id: 'abc123' },
      ttl: 86_400,
      protocol: 'socks5',
    } as const;
    const sticky = buildProxyUrl(USER, KEY, { ...opts, rotation: 'sticky' });
    const hard = buildProxyUrl(USER, KEY, { ...opts, rotation: 'hard' });
    expect(hard).toBe(sticky.replace('-rot-sticky', '-rot-hard'));
    expect(hard).toContain('-rot-hard-strict');
  });

  it('never invents a sid — sticky and hard alike persist nothing without one', () => {
    // Both pinning modes need a caller-supplied `-sid-`; the gateway otherwise
    // synthesizes a throwaway session per connection. The SDK must not paper
    // over that with a generated id, or two processes sharing a credential
    // would silently stop sharing a modem.
    for (const rotation of ['sticky', 'hard'] as const) {
      expect(buildProxyUrl(USER, KEY, { country: 'us', rotation })).not.toContain('-sid-');
    }
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
