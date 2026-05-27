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
      getIncidents: vi.fn(async () => overrides.incidents ?? []),
    },
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
