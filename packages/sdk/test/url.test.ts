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

  it.each(['none', 'auto10', 'auto30', 'sticky', 'sticky-strict', 'hard'] as const)(
    'accepts rotation mode %s',
    (rotation) => {
      const url = buildProxyUrl(USER, KEY, { rotation });
      expect(url).toContain(`-rot-${rotation}`);
    },
  );

  it('emits -rot-sticky-strict for the strict-sticky mode (gateway parses rot=sticky + strict)', () => {
    const url = buildProxyUrl(USER, KEY, {
      country: 'us',
      pool: 'peer',
      sid: 'alice_session1',
      rotation: 'sticky-strict',
    });
    expect(url).toContain('-peer-us-sid-alice_session1-rot-sticky-strict');
  });

  it('throws ProxiesConfigError on missing proxyUsername', () => {
    expect(() => buildProxyUrl('', KEY)).toThrow(ProxiesConfigError);
  });

  it('throws ProxiesConfigError on missing pakKey', () => {
    expect(() => buildProxyUrl(USER, '')).toThrow(ProxiesConfigError);
  });
});
