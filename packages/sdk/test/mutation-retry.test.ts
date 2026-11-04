import { describe, expect, it, vi } from 'vitest';
import { ProxiesClient } from '../src/client';

type Mutation = { name: string; call: (client: ProxiesClient) => Promise<unknown> };
const mutations: Mutation[] = [
  { name: 'unkeyed create', call: (c) => c.poolKeys.create({ label: 'fixture' }) },
  { name: 'keyed create', call: (c) => c.poolKeys.create({ label: 'fixture', idempotencyKey: 'fixture_create' }) },
  { name: 'unkeyed top-up', call: (c) => c.poolKeys.topUp('key1', { addTrafficGB: 1 }) },
  { name: 'keyed top-up', call: (c) => c.poolKeys.topUp('key1', { addTrafficGB: 1, idempotencyKey: 'fixture_topup' }) },
  { name: 'unkeyed regeneration', call: (c) => c.poolKeys.regenerate('key1') },
  { name: 'keyed regeneration', call: (c) => c.poolKeys.regenerate('key1', { idempotencyKey: 'fixture_regen' }) },
  { name: 'key update', call: (c) => c.poolKeys.update('key1', { enabled: false }) },
  { name: 'key deletion', call: (c) => c.poolKeys.delete('key1') },
  { name: 'versioned resume', call: (c) => c.poolKeys.resume('key1', { expectedLifecycleVersion: 2, idempotencyKey: 'fixture_resume' }) },
  { name: 'selected binding release', call: (c) => c.sessions.close('binding1', { pakId: 'key1' }) },
  { name: 'scoped all-binding release', call: (c) => c.sessions.closeAll({ pakId: 'key1' }) },
];

describe('shared-pool mutation retry boundary', () => {
  for (const failure of ['lost response', '503', '429', 'body read failure'] as const) {
    it.each(mutations)(`does not redispatch $name after ${failure}`, async ({ call }) => {
      let applied = 0;
      const fetchMock = vi.fn(async () => {
        applied++;
        if (failure === 'lost response') throw new TypeError('fixture response lost');
        if (failure === 'body read failure') {
          const response = new Response('{}');
          response.text = async () => { throw new TypeError('fixture body interrupted'); };
          return response;
        }
        return new Response('{}', { status: Number(failure) });
      });
      const client = new ProxiesClient({
        apiKey: 'fixture_api_key', fetch: fetchMock as typeof fetch,
        retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
      });
      await expect(call(client)).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(applied).toBe(1);
    });
  }

  it('retains retry for a scoped current-secret read', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fixture connection loss'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'key1', key: 'fixture_current' })));
    const client = new ProxiesClient({
      apiKey: 'fixture_api_key', fetch: fetchMock,
      retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
    });
    await expect(client.poolKeys.get('key1')).resolves.toMatchObject({ id: 'key1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
