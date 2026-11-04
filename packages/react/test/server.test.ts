import { describe, it, expect, vi } from 'vitest';
import { createPoolApiHandlers } from '../src/server';

function makeClientStub(overrides: Partial<{ listKeys: unknown[]; stock: unknown; incidents: unknown[]; regenerate: unknown }> = {}) {
  return {
    proxyUsername: 'psx_abc123',
    poolKeys: {
      list: vi.fn(async () => overrides.listKeys ?? []),
      // server.ts switched from list().find() to get(keyId) in 0.5.0.
      // Stub resolves by id from the same listKeys fixture so existing
      // test cases keep working without each test redefining the stub.
      get: vi.fn(async (id: string) => {
        const all = (overrides.listKeys ?? []) as Array<{ id: string }>;
        const hit = all.find((k) => k.id === id);
        if (!hit) {
          const err: any = new Error('Pool access key not found');
          err.status = 404;
          throw err;
        }
        return hit;
      }),
      regenerate: vi.fn(async (id: string) => ({ id, key: 'pak_new' })),
    },
    pool: {
      getStock: vi.fn(async () => overrides.stock ?? { updatedAt: '', countries: [] }),
      getCarrierStock: vi.fn(async () => ({ country: 'us', total: 3, other: 0, carriers: [] })),
      getFacets: vi.fn(async () => ({ country: 'us', carriers: [], total: 3 })),
      getIncidents: vi.fn(async () => overrides.incidents ?? []),
    },
    request: vi.fn(async (path: string) => {
      if (path.endsWith('/leases')) {
        return {
          enabled: true,
          maxLeases: 5,
          held: 2,
          leases: [
            { leaseId: 'l23d4e83c5b', country: 'US', ipType: 'residential', carrier: 'Comcast', deviceOnline: true, observedIp: '203.0.113.7', strings: [{ http: 'masked' }] },
            { leaseId: 'lother00000', country: 'US', ipType: 'mobile', carrier: 'T-Mobile', deviceOnline: true, observedIp: '203.0.113.8' },
          ],
        };
      }
      if (path === '/private-pool/pools') return [];
      throw new Error(`unexpected request ${path}`);
    }),
    sessions: {
      list: vi.fn(async (_opts?: { pakId?: string }) => ({ sessions: [], count: 0 })),
      close: vi.fn(async (_key: string, _opts?: { pakId?: string }) => ({ success: true, message: 'ok' })),
      closeAll: vi.fn(async (_opts?: { pakId?: string }) => ({ success: true, message: 'ok', count: 0 })),
    },
  } as any;
}

describe('createPoolApiHandlers', () => {
  it('throws if the client has no proxyUsername', () => {
    expect(() =>
      createPoolApiHandlers({
        proxies: { proxyUsername: undefined } as any,
        getSessionUserId: () => null,
        getUserKeyId: () => null,
      }),
    ).toThrow(/proxyUsername/);
  });

  it('GET /me returns 401 when unauthenticated', async () => {
    const { GET } = createPoolApiHandlers({
      proxies: makeClientStub(),
      getSessionUserId: () => null,
      getUserKeyId: () => null,
    });
    const res = await GET(new Request('http://x/api/pool/me'));
    expect(res.status).toBe(401);
  });

  it('GET /me returns 404 when user has no key', async () => {
    const { GET } = createPoolApiHandlers({
      proxies: makeClientStub(),
      getSessionUserId: () => 'user_1',
      getUserKeyId: () => null,
    });
    const res = await GET(new Request('http://x/api/pool/me'));
    expect(res.status).toBe(404);
  });

  it('GET /me returns MeResponse on success', async () => {
    const proxies = makeClientStub({
      listKeys: [
        {
          id: 'k1',
          key: 'pak_secret',
          label: 'customer:1',
          enabled: true,
          trafficCapGB: 10,
          trafficUsedMB: 256,
          trafficUsedGB: 0.25,
          lastUsedAt: null,
          createdAt: 0,
        },
      ],
    });
    const { GET } = createPoolApiHandlers({
      proxies,
      getSessionUserId: () => 'user_1',
      getUserKeyId: () => 'k1',
      gatewayHost: 'edge-eu.proxies.sx',
    });
    const res = await GET(new Request('http://x/api/pool/me'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proxyUsername).toBe('psx_abc123');
    expect(body.pakKey).toBe('pak_secret');
    expect(body.usage.capGB).toBe(10);
    expect(body.gatewayHost).toBe('edge-eu.proxies.sx');
  });

  it('GET /usage returns the caller key usage series and forwards ?days=', async () => {
    const proxies = makeClientStub();
    proxies.poolKeys.usage = vi.fn(async (keyId: string, opts?: { days?: number }) => ({
      keyId, days: opts?.days ?? 30, totalMB: 10, totalGB: 0.0098,
      series: [{ date: '2026-10-05', mbIn: 8, mbOut: 2, mb: 10 }],
    }));
    const { GET } = createPoolApiHandlers({
      proxies,
      getSessionUserId: () => 'user_1',
      getUserKeyId: () => 'k1',
    });
    const res = await GET(new Request('http://x/api/pool/usage?days=7'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(proxies.poolKeys.usage).toHaveBeenCalledWith('k1', { days: 7 });
    expect((await res.json()).series[0].mb).toBe(10);

    const noDays = await GET(new Request('http://x/api/pool/usage'));
    expect(noDays.status).toBe(200);
    expect(proxies.poolKeys.usage).toHaveBeenLastCalledWith('k1', {});
    const { GET: noKey } = createPoolApiHandlers({ proxies, getSessionUserId: () => 'u', getUserKeyId: () => null });
    expect((await noKey(new Request('http://x/api/pool/usage'))).status).toBe(404);
  });

  it('GET /leases never forwards a device exit IP to the browser', async () => {
    const { GET } = createPoolApiHandlers({
      proxies: makeClientStub(),
      getSessionUserId: () => 'user_1',
      getUserKeyId: () => 'k1',
      privatePool: {
        poolId: 'pool_1',
        listUserLeaseIds: () => ['l23d4e83c5b'],
        onLeaseAcquired: () => undefined,
      },
    });
    const res = await GET(new Request('http://x/api/pool/leases'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leases).toHaveLength(1);
    expect(body.leases[0].leaseId).toBe('l23d4e83c5b');
    expect(body.leases[0]).not.toHaveProperty('observedIp');
    expect(body.leases[0]).not.toHaveProperty('strings');
    expect(JSON.stringify(body)).not.toContain('203.0.113');
  });

  it('GET /stock returns public stock', async () => {
    const stock = {
      updatedAt: '2026',
      countries: [{ country: 'us', mbl: { online: 1, total: 1 }, peer: { online: 0, total: 0 } }],
    };
    const { GET } = createPoolApiHandlers({
      proxies: makeClientStub({ stock }),
      getSessionUserId: () => null,
      getUserKeyId: () => null,
    });
    const res = await GET(new Request('http://x/api/pool/stock'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.countries[0].country).toBe('us');
  });

  it('POST /regenerate calls SDK and fires audit callback', async () => {
    const onAudit = vi.fn();
    const proxies = makeClientStub();
    const { POST } = createPoolApiHandlers({
      proxies,
      getSessionUserId: () => 'user_1',
      getUserKeyId: () => 'k1',
      onAudit,
    });
    const res = await POST(new Request('http://x/api/pool/regenerate', { method: 'POST' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('pak_new');
    expect(proxies.poolKeys.regenerate).toHaveBeenCalledWith('k1');
    expect(onAudit).toHaveBeenCalledWith({ type: 'key.regenerated', userId: 'user_1', keyId: 'k1' });
  });


  it('forwards the caller regeneration operation key unchanged', async () => {
    const proxies = makeClientStub();
    const { POST } = createPoolApiHandlers({
      proxies, getSessionUserId: () => 'u1', getUserKeyId: () => 'key1',
    });
    const res = await POST(new Request('http://x/api/pool/regenerate', {
      method: 'POST', headers: { 'Idempotency-Key': 'persisted_operation_1' },
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(proxies.poolKeys.regenerate).toHaveBeenCalledWith('key1', {
      idempotencyKey: 'persisted_operation_1',
    });
  });

  it.each(['tiny', 'operation bad chars', 'x'.repeat(129)])(
    'rejects invalid regeneration operation key %s before dispatch', async (key) => {
      const proxies = makeClientStub();
      const { POST } = createPoolApiHandlers({
        proxies, getSessionUserId: () => 'u1', getUserKeyId: () => 'key1',
      });
      const res = await POST(new Request('http://x/api/pool/regenerate', {
        method: 'POST', headers: { 'Idempotency-Key': key },
      }));
      expect(res.status).toBe(400);
      expect(proxies.poolKeys.regenerate).not.toHaveBeenCalled();
    },
  );

  it('preserves upstream success with an explicit audit warning when the local hook fails', async () => {
    const proxies = makeClientStub();
    const { POST } = createPoolApiHandlers({
      proxies, getSessionUserId: () => 'u1', getUserKeyId: () => 'key1',
      onAudit: async () => { throw new Error('fixture_private_audit_error'); },
    });
    const res = await POST(new Request('http://x/api/pool/regenerate', { method: 'POST' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await res.json();
    expect(body).toMatchObject({ id: 'key1', key: 'pak_new', auditStatus: 'failed' });
    expect(JSON.stringify(body)).not.toContain('fixture_private_audit_error');
    expect(proxies.poolKeys.regenerate).toHaveBeenCalledTimes(1);
  });

  it('reports an ambiguous regeneration without claiming the old password survived', async () => {
    const proxies = makeClientStub();
    proxies.poolKeys.regenerate.mockRejectedValueOnce(new TypeError('fixture_network_lost'));
    const { POST } = createPoolApiHandlers({
      proxies, getSessionUserId: () => 'u1', getUserKeyId: () => 'key1',
    });
    const res = await POST(new Request('http://x/api/pool/regenerate', { method: 'POST' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: 'upstream_error', mutationOutcome: 'unknown', retryAllowed: false,
    });
    expect(proxies.poolKeys.regenerate).toHaveBeenCalledTimes(1);
  });

  it('GET /my-sessions scopes to the caller pak (multi-tenant isolation)', async () => {
    const proxies = makeClientStub();
    const { GET } = createPoolApiHandlers({
      proxies,
      getSessionUserId: () => 'u1',
      getUserKeyId: () => 'k_customer_1',
    });
    const res = await GET(new Request('https://x/api/pool/my-sessions'));
    expect(res.status).toBe(200);
    // Must forward the caller's own key id as pakId — never an unscoped list().
    expect(proxies.sessions.list).toHaveBeenCalledWith({ pakId: 'k_customer_1' });
  });

  it('GET /my-sessions returns empty (no unscoped list) when user has no key', async () => {
    const proxies = makeClientStub();
    const { GET } = createPoolApiHandlers({
      proxies,
      getSessionUserId: () => 'u1',
      getUserKeyId: () => null,
    });
    const res = await GET(new Request('https://x/api/pool/my-sessions'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [], count: 0 });
    expect(proxies.sessions.list).not.toHaveBeenCalled();
  });

  it('DELETE /my-sessions/:key scopes close to the caller pak', async () => {
    const proxies = makeClientStub();
    const { DELETE } = createPoolApiHandlers({
      proxies,
      getSessionUserId: () => 'u1',
      getUserKeyId: () => 'k_customer_1',
    });
    await DELETE(new Request('https://x/api/pool/my-sessions/sess_abc', { method: 'DELETE' }));
    expect(proxies.sessions.close).toHaveBeenCalledWith('sess_abc', { pakId: 'k_customer_1' });
  });

  it('unknown path returns 404', async () => {
    const { GET } = createPoolApiHandlers({
      proxies: makeClientStub(),
      getSessionUserId: () => null,
      getUserKeyId: () => null,
    });
    const res = await GET(new Request('http://x/api/pool/something-else'));
    expect(res.status).toBe(404);
  });
});


describe('carrier stock source scope', () => {
  it.each([
    ['', undefined], ['peer', 'peer'], ['mbl', 'mbl'], ['all', 'all'], ['any', 'all'], ['unknown', undefined],
  ])('forwards %s without changing the omitted peer default', async (requested, expected) => {
    const proxies = makeClientStub();
    const { GET } = createPoolApiHandlers({ proxies, getSessionUserId: () => null, getUserKeyId: () => null });
    const response = await GET(new Request(`https://fixture.test/api/pool/stock/carriers?country=us${requested ? `&pool=${requested}` : ''}`));
    expect(response.status).toBe(200);
    expect(proxies.pool.getCarrierStock).toHaveBeenCalledWith({ country: 'us', pool: expected });
    expect((await response.json()).total).toBe(3);
  });

  it('maps any to all for facets while retaining exact requested provider and geography', async () => {
    const proxies = makeClientStub();
    const { GET } = createPoolApiHandlers({ proxies, getSessionUserId: () => null, getUserKeyId: () => null });
    const response = await GET(new Request('https://fixture.test/api/pool/stock/facets?country=us&pool=any&carrier=as64501%7Cresidential&state=ny&city=example'));
    expect(response.status).toBe(200);
    expect(proxies.pool.getFacets).toHaveBeenCalledWith({ country: 'us', pool: 'all', carrier: 'as64501|residential', state: 'ny', city: 'example' });
  });
});
