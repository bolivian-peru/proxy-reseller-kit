import { describe, it, expect, vi } from 'vitest';
import { ProxiesClient } from '../src/client';
import {
  ProxiesApiError,
  ProxiesConfigError,
  ProxiesTimeoutError,
} from '../src/errors';

/** Build a mock fetch that responds with the given status + body + optional headers. */
function mockFetch(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const lowered = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      headers: {
        get: (k: string) => lowered[k.toLowerCase()] ?? null,
      },
    } as unknown as Response;
  });
}

const KEY_FIXTURE = {
  id: '65fabc',
  key: 'pak_000000000000000000000001',
  label: 'test',
  enabled: true,
  trafficCapGB: 10,
  trafficUsedMB: 0,
  lastUsedAt: null,
  createdAt: 1_700_000_000_000,
};

describe('ProxiesClient', () => {
  it('throws ProxiesConfigError when apiKey is missing', () => {
    expect(() => new ProxiesClient({ apiKey: '' })).toThrow(ProxiesConfigError);
  });

  it('throws ProxiesConfigError when neither config.fetch nor globalThis.fetch is present', () => {
    const originalFetch = (globalThis as { fetch?: unknown }).fetch;
    // Simulate an environment without global fetch (pre-Node-18, some edge runtimes)
    (globalThis as { fetch?: unknown }).fetch = undefined;
    try {
      expect(() => new ProxiesClient({ apiKey: 'psx_test' })).toThrow(ProxiesConfigError);
    } finally {
      (globalThis as { fetch?: unknown }).fetch = originalFetch;
    }
  });

  it('sends X-API-Key header on every request', async () => {
    const fetchMock = mockFetch(200, []);
    const client = new ProxiesClient({
      apiKey: 'psx_secret',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.list();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      'X-API-Key': 'psx_secret',
    });
  });

  it('throws ProxiesApiError on 4xx and exposes helpers', async () => {
    const fetchMock = mockFetch(401, { error: 'unauthorized' });
    const client = new ProxiesClient({
      apiKey: 'psx_bad',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = await client.poolKeys
      .list()
      .then(() => null)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ProxiesApiError);
    expect(err.status).toBe(401);
    expect(err.isAuth).toBe(true);
    expect(err.isRateLimited).toBe(false);
  });

  it('isRateLimited returns true on 429', async () => {
    const fetchMock = mockFetch(429, { error: 'slow down' });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = (await client.poolKeys.list().catch((e) => e)) as ProxiesApiError;
    expect(err.isRateLimited).toBe(true);
    expect(err.isServer).toBe(false);
  });

  it('isServer returns true on 5xx', async () => {
    const fetchMock = mockFetch(503, 'upstream down');
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const err = (await client.poolKeys.list().catch((e) => e)) as ProxiesApiError;
    expect(err.isServer).toBe(true);
    expect(err.body).toBe('upstream down');
  });

  it('parses successful JSON responses', async () => {
    const fetchMock = mockFetch(200, [KEY_FIXTURE]);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const keys = await client.poolKeys.list();
    expect(keys).toHaveLength(1);
    expect(keys[0]?.key).toBe(KEY_FIXTURE.key);
  });

  it('validates create() input client-side', async () => {
    const fetchMock = mockFetch(200, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.poolKeys.create({ label: '' })).rejects.toThrow(ProxiesConfigError);
    // Server is never called when client-side validation fails
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('buildProxyUrl requires proxyUsername in config', () => {
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: mockFetch(200, {}) as unknown as typeof fetch,
    });
    expect(() => client.buildProxyUrl('pak_xxx')).toThrow(ProxiesConfigError);
  });

  it('buildProxyUrl uses configured proxyUsername and gatewayHost', () => {
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      proxyUsername: 'psx_me',
      gatewayHost: 'edge.proxies.sx',
      fetch: mockFetch(200, {}) as unknown as typeof fetch,
    });
    const url = client.buildProxyUrl('pak_yyyyyyyyyyyyyyyyyyyyyyyy', { country: 'us' });
    expect(url).toContain('@edge.proxies.sx:7000');
    expect(url).toContain('psx_me-mbl-us');
  });

  it('translates AbortError into ProxiesTimeoutError', async () => {
    const fetchMock = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      timeout: 10,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.poolKeys.list()).rejects.toBeInstanceOf(ProxiesTimeoutError);
  });

  it('URL-encodes keyId in path params', async () => {
    const fetchMock = mockFetch(200, { id: 'a/b', key: 'pak_new' });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.regenerate('a/b');
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/reseller/pool-keys/a%2Fb/regenerate');
  });

  // ────────────────────────────────────────────────────────────────────
  //  0.3.0: retry, idempotency, requestId, topUp, get
  // ────────────────────────────────────────────────────────────────────

  it('retries on 502 then succeeds', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      const text = calls < 2 ? 'upstream' : JSON.stringify([KEY_FIXTURE]);
      return {
        ok: calls >= 2,
        status: calls < 2 ? 502 : 200,
        text: async () => text,
        headers: { get: () => null },
      } as unknown as Response;
    });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const keys = await client.poolKeys.list();
    expect(calls).toBe(2);
    expect(keys).toHaveLength(1);
  });

  it('does NOT retry on 400', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return {
        ok: false,
        status: 400,
        text: async () => 'bad request',
        headers: { get: () => null },
      } as unknown as Response;
    });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.poolKeys.list()).rejects.toBeInstanceOf(ProxiesApiError);
    expect(calls).toBe(1);
  });

  it('honors Retry-After header on 429', async () => {
    let calls = 0;
    const start = Date.now();
    const fetchMock = vi.fn(async () => {
      calls++;
      const ok = calls >= 2;
      return {
        ok,
        status: ok ? 200 : 429,
        text: async () => (ok ? JSON.stringify([KEY_FIXTURE]) : 'rate limited'),
        headers: {
          get: (k: string) =>
            !ok && k.toLowerCase() === 'retry-after' ? '0' : null,
        },
      } as unknown as Response;
    });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 5 },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const keys = await client.poolKeys.list();
    expect(keys).toHaveLength(1);
    expect(calls).toBe(2);
    expect(Date.now() - start).toBeLessThan(500); // Retry-After=0 → no delay
  });

  it('disables retry when retry: false', async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return {
        ok: false,
        status: 502,
        text: async () => 'upstream',
        headers: { get: () => null },
      } as unknown as Response;
    });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.poolKeys.list()).rejects.toBeInstanceOf(ProxiesApiError);
    expect(calls).toBe(1);
  });

  it('passes Idempotency-Key header on create', async () => {
    const fetchMock = mockFetch(201, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.create({
      label: 'alice',
      idempotencyKey: 'pi_test_idem_42',
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'pi_test_idem_42',
    });
    // Should NOT pass idempotencyKey through in the body
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.idempotencyKey).toBeUndefined();
  });

  it('populates ProxiesApiError.requestId from X-Request-ID header', async () => {
    const fetchMock = mockFetch(500, 'oops', { 'X-Request-ID': 'req_abc123def' });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    try {
      await client.poolKeys.list();
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ProxiesApiError);
      expect((err as ProxiesApiError).requestId).toBe('req_abc123def');
      expect((err as ProxiesApiError).isRetryable).toBe(true);
    }
  });

  it('topUp validates inputs', async () => {
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: mockFetch(200, KEY_FIXTURE) as unknown as typeof fetch,
    });
    await expect(client.poolKeys.topUp('id', {})).rejects.toThrow(
      /addTrafficGB or extendDays/,
    );
    await expect(
      client.poolKeys.topUp('id', { addTrafficGB: -1 }),
    ).rejects.toThrow(/addTrafficGB/);
  });

  it('topUp posts to /:id/topup with body and idempotency header', async () => {
    const fetchMock = mockFetch(200, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.topUp('abc', {
      addTrafficGB: 5,
      extendDays: 30,
      idempotencyKey: 'topup_invoice_42',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/reseller/pool-keys/abc/topup');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'topup_invoice_42',
    });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ addTrafficGB: 5, extendDays: 30 });
  });

  it('get fetches a single key by id', async () => {
    const fetchMock = mockFetch(200, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const k = await client.poolKeys.get('65fabc');
    expect(k.id).toBe('65fabc');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/reseller/pool-keys/65fabc');
    expect((init as RequestInit).method).toBeUndefined(); // GET (default)
  });

  // ────────────────────────────────────────────────────────────────────
  //  0.5.0: reveal + audit endpoints (Pool Access Key security hardening)
  // ────────────────────────────────────────────────────────────────────

  it('reveal posts to /:id/reveal and returns the full key record', async () => {
    const fetchMock = mockFetch(200, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const k = await client.poolKeys.reveal('65fabc');
    expect(k.key).toBe(KEY_FIXTURE.key);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/reseller/pool-keys/65fabc/reveal');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('audit() builds query string with action / before / limit', async () => {
    const fetchMock = mockFetch(200, []);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.audit({
      action: 'auto_suspended_cap_exceeded',
      before: '2026-05-01T00:00:00Z',
      limit: 50,
    });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/reseller/pool-keys/audit?');
    expect(url).toContain('action=auto_suspended_cap_exceeded');
    expect(url).toContain('before=2026-05-01');
    expect(url).toContain('limit=50');
  });

  it('audit() with no opts hits the bare path', async () => {
    const fetchMock = mockFetch(200, []);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.audit();
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/reseller\/pool-keys\/audit$/);
  });

  it('audit() accepts a Date for `before` and serializes ISO', async () => {
    const fetchMock = mockFetch(200, []);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.audit({ before: new Date('2026-04-01T12:00:00Z') });
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toContain('before=2026-04-01T12');
  });

  it('audit() rejects non-positive limit', async () => {
    const client = new ProxiesClient({ apiKey: 'psx_x' });
    await expect(client.poolKeys.audit({ limit: 0 })).rejects.toThrow(
      /limit must be > 0/,
    );
  });

  it('auditForKey() builds the per-key path with limit / before only', async () => {
    const fetchMock = mockFetch(200, []);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.poolKeys.auditForKey('a/b', {
      limit: 25,
      before: '2026-04-30T00:00:00Z',
    });
    const [url] = fetchMock.mock.calls[0]!;
    // keyId URL-encoded
    expect(url).toContain('/reseller/pool-keys/a%2Fb/audit?');
    expect(url).toContain('limit=25');
    expect(url).toContain('before=2026-04-30');
    // Per-key endpoint does NOT support action filter — should not appear
    expect(url).not.toContain('action=');
  });

  it('auditForKey() requires keyId', async () => {
    const client = new ProxiesClient({ apiKey: 'psx_x' });
    await expect(client.poolKeys.auditForKey('')).rejects.toThrow(
      /keyId is required/,
    );
  });

  it('reveal() requires keyId', async () => {
    const client = new ProxiesClient({ apiKey: 'psx_x' });
    await expect(client.poolKeys.reveal('')).rejects.toThrow(
      /keyId is required/,
    );
  });

  // ────────────────────────────────────────────────────────────────────
  //  0.3.1: pool.getStock() shape lock + runtime validator
  //  Coronium audit 2026-05-01 — type was unrelated to the live shape.
  // ────────────────────────────────────────────────────────────────────

  it('pool.getStock() returns the live { pools, totals, generatedAt } shape', async () => {
    const live = {
      pools: {
        mbl: { us: 73, de: 19, fr: 18, es: 25, gb: 22 },
        peer: { us: 0, ch: 1 },
      },
      totals: { mbl: 157, peer: 1, all: 158 },
      generatedAt: '2026-05-01T09:34:32.449Z',
    };
    const fetchMock = mockFetch(200, live);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    const stock = await client.pool.getStock();
    expect(stock.pools.mbl.us).toBe(73);
    expect(stock.pools.peer.ch).toBe(1);
    expect(stock.totals.all).toBe(158);
    expect(stock.generatedAt).toBe('2026-05-01T09:34:32.449Z');
  });

  it('pool.getStock() throws on broken upstream shape', async () => {
    // The pre-0.3.1 (incorrect) declared shape — should now be rejected.
    const fetchMock = mockFetch(200, {
      updatedAt: '2026-01-01T00:00:00Z',
      countries: [],
    });
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: false,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(client.pool.getStock()).rejects.toThrow(/PoolStock response shape unexpected/);
  });
  // ────────────────────────────────────────────────────────────────────
  //  0.10.0: retry gating by method + Idempotency-Key, private modems
  // ────────────────────────────────────────────────────────────────────

  /** fetch that fails `failures` times with 502, then answers 200 with `body`. */
  function flakyFetch(failures: number, body: unknown) {
    let calls = 0;
    const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
      calls++;
      const ok = calls > failures;
      return {
        ok,
        status: ok ? 200 : 502,
        text: async () => (ok ? JSON.stringify(body) : 'upstream'),
        headers: { get: () => null },
      } as unknown as Response;
    });
    return { fn, calls: () => calls };
  }

  const RETRYING = { attempts: 3, baseDelayMs: 1, maxDelayMs: 2 };

  function headerOf(init: RequestInit | undefined, name: string): string | undefined {
    return (init?.headers as Record<string, string> | undefined)?.[name];
  }

  it('does NOT retry a POST without Idempotency-Key on 502', async () => {
    const flaky = flakyFetch(1, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: RETRYING,
      fetch: flaky.fn as unknown as typeof fetch,
    });
    // reveal is a POST the platform does not key
    await expect(client.poolKeys.reveal('65fabc')).rejects.toBeInstanceOf(ProxiesApiError);
    expect(flaky.calls()).toBe(1);
  });

  it('does NOT retry an un-keyed PATCH or DELETE on 502', async () => {
    const patch = flakyFetch(1, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: RETRYING,
      fetch: patch.fn as unknown as typeof fetch,
    });
    await expect(client.request('/x', { method: 'PATCH', body: '{}' })).rejects.toBeInstanceOf(ProxiesApiError);
    expect(patch.calls()).toBe(1);

    const del = flakyFetch(1, {});
    const client2 = new ProxiesClient({
      apiKey: 'psx_x',
      retry: RETRYING,
      fetch: del.fn as unknown as typeof fetch,
    });
    await expect(client2.poolKeys.delete('65fabc')).rejects.toBeInstanceOf(ProxiesApiError);
    expect(del.calls()).toBe(1);
  });

  it('poolKeys.update is keyed: retried on 502 under the same generated key, key kept out of the body', async () => {
    const flaky = flakyFetch(1, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: RETRYING,
      fetch: flaky.fn as unknown as typeof fetch,
    });
    const key = await client.poolKeys.update('65fabc', { enabled: false, idempotencyKey: 'pause_ticket_77' });
    expect(key.id).toBe(KEY_FIXTURE.id);
    expect(flaky.calls()).toBe(2);
    for (const [, init] of flaky.fn.mock.calls) {
      expect(init?.method).toBe('PATCH');
      expect(headerOf(init, 'Idempotency-Key')).toBe('pause_ticket_77');
      expect(JSON.parse(init?.body as string)).toEqual({ enabled: false });
    }

    const plain = mockFetch(200, KEY_FIXTURE);
    const client2 = new ProxiesClient({ apiKey: 'psx_x', fetch: plain as unknown as typeof fetch });
    await client2.poolKeys.update('65fabc', { label: 'x' });
    expect(headerOf(plain.mock.calls[0]![1] as RequestInit, 'Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('stamps the Idempotency-Key on the error when every attempt fails', async () => {
    const flaky = flakyFetch(99, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: RETRYING,
      fetch: flaky.fn as unknown as typeof fetch,
    });
    const err = await client.poolKeys.create({ label: 'alice', idempotencyKey: 'pi_test_idem_42' }).catch((e) => e);
    expect(err).toBeInstanceOf(ProxiesApiError);
    expect(err.idempotencyKey).toBe('pi_test_idem_42');
    expect(flaky.calls()).toBe(RETRYING.attempts);
  });

  it('stamps the generated Idempotency-Key on a ProxiesTimeoutError from a money call', async () => {
    let sent: string | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sent = headerOf(init, 'Idempotency-Key');
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    const client = new ProxiesClient({ apiKey: 'psx_x', retry: false, fetch: fetchMock as unknown as typeof fetch });
    const err = await client.privateModems.buy({ tariffId: 'pt_1', expectedPriceUsd: 33 }).catch((e) => e);
    expect(err).toBeInstanceOf(ProxiesTimeoutError);
    expect(sent).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(err.idempotencyKey).toBe(sent);
  });

  it('leaves idempotencyKey undefined on an error from an un-keyed request', async () => {
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: mockFetch(502, 'upstream') as unknown as typeof fetch, retry: false });
    const err = await client.privateModems.rotate('pm_1').catch((e) => e);
    expect(err).toBeInstanceOf(ProxiesApiError);
    expect(err.idempotencyKey).toBeUndefined();
  });

  it('retries a POST with Idempotency-Key on 502 and sends the same key both times', async () => {
    const flaky = flakyFetch(1, KEY_FIXTURE);
    const client = new ProxiesClient({
      apiKey: 'psx_x',
      retry: RETRYING,
      fetch: flaky.fn as unknown as typeof fetch,
    });
    const key = await client.poolKeys.create({ label: 'alice', idempotencyKey: 'pi_test_idem_42' });
    expect(key.id).toBe(KEY_FIXTURE.id);
    expect(flaky.calls()).toBe(2);
    const [, first] = flaky.fn.mock.calls[0]!;
    const [, second] = flaky.fn.mock.calls[1]!;
    expect(headerOf(first, 'Idempotency-Key')).toBe('pi_test_idem_42');
    expect(headerOf(second, 'Idempotency-Key')).toBe('pi_test_idem_42');
  });

  it('poolKeys.create / topUp / regenerate generate an Idempotency-Key when none is passed', async () => {
    const fetchMock = mockFetch(200, KEY_FIXTURE);
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    await client.poolKeys.create({ label: 'alice' });
    await client.poolKeys.topUp('65fabc', { addTrafficGB: 1 });
    await client.poolKeys.regenerate('65fabc');
    const keys = fetchMock.mock.calls.map(([, init]) => headerOf(init as RequestInit, 'Idempotency-Key'));
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(new Set(keys).size).toBe(3);
  });

  it('rejects a malformed idempotencyKey before calling the server', async () => {
    const fetchMock = mockFetch(200, KEY_FIXTURE);
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.poolKeys.create({ label: 'a', idempotencyKey: 'short' })).rejects.toThrow(ProxiesConfigError);
    await expect(client.poolKeys.create({ label: 'a', idempotencyKey: 'has spaces inside' })).rejects.toThrow(ProxiesConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const ORDER_FIXTURE = {
    orderId: 'pmb0123456789abcdef',
    kind: 'buy',
    status: 'pending',
    priceUsd: 33,
    modemId: null,
    countryName: 'Germany',
    carrierName: 'O2',
    period: 'month',
    quantity: 1,
    regionName: null,
    createdAt: '2026-11-07T10:00:00.000Z',
    error: null,
    refunded: false,
  };

  it('privateModems.buy generates one key per call and strips it from the body', async () => {
    const fetchMock = mockFetch(200, ORDER_FIXTURE);
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    const order = await client.privateModems.buy({ tariffId: 'pt_abc', expectedPriceUsd: 33 });
    expect(order.orderId).toBe(ORDER_FIXTURE.orderId);
    await client.privateModems.buy({ tariffId: 'pt_abc', expectedPriceUsd: 33 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/private-modems\/orders$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ tariffId: 'pt_abc', expectedPriceUsd: 33 });
    const k1 = headerOf(init as RequestInit, 'Idempotency-Key');
    const k2 = headerOf(fetchMock.mock.calls[1]![1] as RequestInit, 'Idempotency-Key');
    expect(k1).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(k2).not.toBe(k1);
  });

  it('privateModems.buy passes a caller key through and is retried with that same key', async () => {
    const flaky = flakyFetch(1, ORDER_FIXTURE);
    const client = new ProxiesClient({ apiKey: 'psx_x', retry: RETRYING, fetch: flaky.fn as unknown as typeof fetch });
    await client.privateModems.buy({ tariffId: 'pt_abc', expectedPriceUsd: 33, idempotencyKey: 'invoice_2026_0042' });
    expect(flaky.calls()).toBe(2);
    for (const [, init] of flaky.fn.mock.calls) {
      expect(headerOf(init, 'Idempotency-Key')).toBe('invoice_2026_0042');
    }
  });

  it('privateModems.buy validates tariffId and expectedPriceUsd client-side', async () => {
    const fetchMock = mockFetch(200, ORDER_FIXTURE);
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.privateModems.buy({ tariffId: '', expectedPriceUsd: 33 })).rejects.toThrow(/tariffId/);
    await expect(
      client.privateModems.buy({ tariffId: 'pt_abc' } as unknown as { tariffId: string; expectedPriceUsd: number }),
    ).rejects.toThrow(/expectedPriceUsd/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('privateModems.buyCart posts items + confirmAgain under one generated key', async () => {
    const fetchMock = mockFetch(200, { cartId: 'pmc_1', orders: [ORDER_FIXTURE] });
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    const cart = await client.privateModems.buyCart({
      items: [{ tariffId: 'pt_abc', quantity: 2, expectedPriceUsd: 33, p0f: true }],
      confirmAgain: true,
    });
    expect(cart.cartId).toBe('pmc_1');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      items: [{ tariffId: 'pt_abc', quantity: 2, expectedPriceUsd: 33, p0f: true }],
      confirmAgain: true,
    });
    expect(headerOf(init as RequestInit, 'Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    await expect(client.privateModems.buyCart({ items: [] })).rejects.toThrow(ProxiesConfigError);
  });

  it('privateModems.renew posts to /:id/renew with period and a key', async () => {
    const fetchMock = mockFetch(200, { ...ORDER_FIXTURE, kind: 'renew', period: 'week' });
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    const order = await client.privateModems.renew('m/1', { expectedPriceUsd: 12, period: 'week' });
    expect(order.period).toBe('week');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/private-modems/m%2F1/renew');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ expectedPriceUsd: 12, period: 'week' });
    expect(headerOf(init as RequestInit, 'Idempotency-Key')).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });

  it('privateModems.rotate and replace are not retried on 502', async () => {
    for (const call of ['rotate', 'replace'] as const) {
      const flaky = flakyFetch(1, {});
      const client = new ProxiesClient({ apiKey: 'psx_x', retry: RETRYING, fetch: flaky.fn as unknown as typeof fetch });
      await expect(client.privateModems[call]('m1')).rejects.toBeInstanceOf(ProxiesApiError);
      expect(flaky.calls()).toBe(1);
      const [url, init] = flaky.fn.mock.calls[0]!;
      expect(url).toContain(`/private-modems/m1/${call}`);
      expect(init?.method).toBe('POST');
      expect(headerOf(init, 'Idempotency-Key')).toBeUndefined();
    }
  });

  it('privateModems.setAutoRenew PUTs { enabled, period }', async () => {
    const fetchMock = mockFetch(200, { autoRenew: true, autoRenewPeriod: 'month' });
    const client = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    const res = await client.privateModems.setAutoRenew('m1', { enabled: true, period: 'month' });
    expect(res.autoRenew).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/private-modems/m1/auto-renew');
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ enabled: true, period: 'month' });
  });

  it('privateModems GET methods hit the documented paths and still retry', async () => {
    const flaky = flakyFetch(1, { maxCartModems: 20, tariffs: [] });
    const client = new ProxiesClient({ apiKey: 'psx_x', retry: RETRYING, fetch: flaky.fn as unknown as typeof fetch });
    const catalog = await client.privateModems.catalog();
    expect(catalog.maxCartModems).toBe(20);
    expect(flaky.calls()).toBe(2);

    const fetchMock = mockFetch(200, {});
    const client2 = new ProxiesClient({ apiKey: 'psx_x', fetch: fetchMock as unknown as typeof fetch });
    await client2.privateModems.status();
    await client2.privateModems.mine();
    await client2.privateModems.renewalQuote('m1');
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toMatch(/\/private-modems\/status$/);
    expect(urls[1]).toMatch(/\/private-modems\/mine$/);
    expect(urls[2]).toMatch(/\/private-modems\/m1\/renewal-quote$/);
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).method).toBeUndefined();
  });
});
