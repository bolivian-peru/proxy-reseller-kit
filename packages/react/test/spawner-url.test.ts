import { describe, expect, it } from 'vitest';
import { buildProxyString } from '../src/PoolSessionSpawner';

const base = {
  proxyUsername: 'psx_abc123',
  proxyPassword: 'pak_0000000000000000000000000001',
  pool: 'mbl' as const,
  country: 'us' as const,
  protocol: 'http' as const,
  rotation: 'none' as const,
  sessionType: 'unique' as const,
  sessionPrefix: 'aaa',
  index: 1,
};

function username(url: string): string {
  // http://<username>:<password>@host:port  → decode the username half
  const withoutScheme = url.replace(/^https?:\/\//, '');
  return decodeURIComponent(withoutScheme.split(':')[0]);
}

describe('buildProxyString failover token', () => {
  it('omits -failover- for the default samecountry', () => {
    const url = buildProxyString({ ...base, failover: 'samecountry' });
    expect(username(url)).not.toContain('failover');
  });

  it('emits -failover- only when overriding the default', () => {
    for (const f of ['any', 'samecarrier', 'samenode', 'strict'] as const) {
      const url = buildProxyString({ ...base, failover: f });
      expect(username(url)).toContain(`-failover-${f}`);
    }
  });

  it('omits -failover- when not provided', () => {
    const url = buildProxyString(base);
    expect(username(url)).not.toContain('failover');
  });
});

describe('buildProxyString rotation + ttl guards (parity with the live parser)', () => {
  it('does not emit a bogus -rot-none / -rot-auto10 token', () => {
    expect(username(buildProxyString({ ...base, rotation: 'none' }))).not.toContain('-rot-');
    expect(username(buildProxyString({ ...base, rotation: 'auto10' }))).not.toContain('-rot-');
  });

  it('emits -rot- for real rotation modes', () => {
    expect(username(buildProxyString({ ...base, rotation: 'sticky' }))).toContain('-rot-sticky');
    expect(username(buildProxyString({ ...base, rotation: 'auto5' }))).toContain('-rot-auto5');
  });

  it('clamps ttl into the 60..2_592_000 window', () => {
    expect(username(buildProxyString({ ...base, ttlSeconds: 2_592_000 }))).toContain('-ttl-2592000');
    // CLAMPED to the floor, not dropped. This assertion used to expect a drop,
    // which was the divergence itself: the SDK clamped while this emitter
    // dropped, so the same input routed two different ways depending on which
    // public API the reseller reached for. The gateway parser also clamps
    // (-ttl-30 heals to 60), so clamping is what the whole stack agrees on —
    // and dropping silently gave the customer 3600 when they asked for 30.
    expect(username(buildProxyString({ ...base, ttlSeconds: 30 }))).toContain('-ttl-60');
    expect(username(buildProxyString({ ...base, ttlSeconds: 5_000_000 }))).toContain('-ttl-2592000');
  });
});
