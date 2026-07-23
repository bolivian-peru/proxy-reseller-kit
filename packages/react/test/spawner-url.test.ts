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
    // below floor is dropped (not emitted)
    expect(username(buildProxyString({ ...base, ttlSeconds: 30 }))).not.toContain('-ttl-');
  });
});
