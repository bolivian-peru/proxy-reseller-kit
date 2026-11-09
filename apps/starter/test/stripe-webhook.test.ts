import { beforeEach, describe, expect, it, vi } from 'vitest';
import { operationToken, type Delivery, type FulfillmentStore, type PaidSession } from '@/lib/fulfillment';

/**
 * Drives the real webhook route and the real fulfillment logic. Only the
 * edges are replaced: Stripe signature parsing, Postgres and the provider API.
 */
const world = vi.hoisted(() => ({
  events: new Set<string>(),
  purchases: new Map<string, { userId: number; gb: number; state: 'pending' | 'delivered'; token: string | null; attempt: number }>(),
  customers: new Map<number, { keyId: string | null; totalGb: number }>(),
  failComplete: 0,
  // Provider side.
  keys: new Map<string, { id: string; trafficCapGB: number; enabled: boolean; lifecycleHolds: string[]; lifecycleVersion: number }>(),
  operations: new Map<string, { state: string; targetId: string }>(),
  dispatches: [] as string[],
  /** What the provider does with the next dispatch. */
  next: 'apply' as 'apply' | 'down' | 'lost' | 'reject' | 'uncertain',
}));

vi.mock('@/lib/stripe', () => ({
  stripe: { webhooks: { constructEvent: (raw: string) => JSON.parse(raw) } },
}));

vi.mock('@/lib/db', () => ({
  query: async (sql: string, params: string[]) => {
    if (sql.startsWith('SELECT')) return world.events.has(params[0]) ? [{}] : [];
    world.events.add(params[0]);
    return [];
  },
}));

vi.mock('@/lib/fulfillment-store', () => {
  const purchaseStore: FulfillmentStore = {
    async claim(paid: PaidSession): Promise<Delivery> {
      if (!world.purchases.has(paid.sessionId)) {
        world.purchases.set(paid.sessionId, { userId: paid.userId, gb: paid.gb, state: 'pending', token: null, attempt: 1 });
      }
      if (!world.customers.has(paid.userId)) world.customers.set(paid.userId, { keyId: null, totalGb: 0 });
      const row = world.purchases.get(paid.sessionId)!;
      if (row.state === 'delivered') return { delivered: true };
      const keyId = world.customers.get(paid.userId)!.keyId;
      const fresh = !row.token;
      if (!row.token) {
        const busy = [...world.purchases.values()].some((p) => p.userId === paid.userId && p.state === 'pending' && p.token);
        if (busy) throw new Error('another purchase is still being delivered');
        row.token = operationToken(keyId, paid.sessionId, row.attempt);
      }
      return { delivered: false, token: row.token, fresh, keyId, gb: row.gb };
    },
    async reissue(sessionId, rejectedToken) {
      const row = world.purchases.get(sessionId)!;
      if (row.token !== rejectedToken || row.state !== 'pending') return;
      row.token = null;
      row.attempt += 1;
    },
    async complete(sessionId, keyId) {
      if (world.failComplete-- > 0) throw new Error('local write failed');
      const row = world.purchases.get(sessionId)!;
      if (row.state !== 'pending') return;
      row.state = 'delivered';
      const customer = world.customers.get(row.userId)!;
      customer.keyId = keyId;
      customer.totalGb += row.gb;
    },
  };
  return { purchaseStore };
});

vi.mock('@/lib/proxies', () => {
  const apiError = (status: number, message: string) => Object.assign(new Error(message), { status });
  /** One provider write under an Idempotency-Key, with the outcome chosen by `world.next`. */
  function dispatch(token: string, targetId: string, effect: () => void) {
    world.dispatches.push(token);
    const outcome = world.next;
    world.next = 'apply';
    if (outcome === 'down') throw apiError(503, 'provider unavailable');
    if (world.operations.has(token)) throw apiError(409, 'replayed token');
    if (outcome === 'reject') {
      world.operations.set(token, { state: 'rejected', targetId });
      throw apiError(409, 'KEY_MUTATION_BUSY');
    }
    if (outcome === 'uncertain') {
      world.operations.set(token, { state: 'uncertain', targetId });
      throw apiError(504, 'timeout');
    }
    effect();
    world.operations.set(token, { state: 'applied', targetId });
    if (outcome === 'lost') throw new TypeError('response lost');
    return world.keys.get(targetId)!;
  }
  const poolKeys = {
    async create(input: { trafficCapGB: number; idempotencyKey: string }) {
      const id = `key${world.keys.size + 1}`;
      return dispatch(input.idempotencyKey, id, () => {
        world.keys.set(id, { id, trafficCapGB: input.trafficCapGB, enabled: true, lifecycleHolds: [], lifecycleVersion: 1 });
      });
    },
    async topUp(keyId: string, input: { addTrafficGB: number; idempotencyKey: string }) {
      return dispatch(input.idempotencyKey, keyId, () => {
        const key = world.keys.get(keyId)!;
        key.trafficCapGB += input.addTrafficGB;
        key.lifecycleVersion += 1;
      });
    },
    async operationByToken(token: string) {
      const operation = world.operations.get(token);
      if (!operation) throw apiError(404, 'No retained operation found');
      return operation;
    },
  };
  return { proxies: { poolKeys } };
});

import { POST } from '@/app/api/stripe/webhook/route';

function checkoutEvent(eventId: string, sessionId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: sessionId,
        payment_status: 'paid',
        amount_total: 3500,
        metadata: { userId: '1', tierId: 'starter', gb: '5' },
      },
    },
    ...overrides,
  };
}

async function deliver(event: object): Promise<number> {
  const res = await POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 'test' },
      body: JSON.stringify(event),
    }),
  );
  return res.status;
}

const mints = () => world.dispatches.filter((t) => t.startsWith('mint_'));
const topUps = () => world.dispatches.filter((t) => t.startsWith('topup_'));

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  world.events.clear();
  world.purchases.clear();
  world.customers.clear();
  world.keys.clear();
  world.operations.clear();
  world.dispatches.length = 0;
  world.failComplete = 0;
  world.next = 'apply';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('Stripe webhook delivery recovery', () => {
  it('delivers on the Stripe retry after the provider was down', async () => {
    world.next = 'down';
    expect(await deliver(checkoutEvent('evt_1', 'cs_test_1'))).toBe(500);
    expect(world.purchases.get('cs_test_1')).toMatchObject({ state: 'pending', token: 'mint_cs_test_1' });

    expect(await deliver(checkoutEvent('evt_1', 'cs_test_1'))).toBe(200);
    expect(world.keys.size).toBe(1);
    expect(world.customers.get(1)).toEqual({ keyId: 'key1', totalGb: 5 });
    expect(world.purchases.get('cs_test_1')!.state).toBe('delivered');
  });

  it('reads the operation instead of minting again when the provider answer was lost', async () => {
    world.next = 'lost';
    expect(await deliver(checkoutEvent('evt_2', 'cs_test_2'))).toBe(500);
    expect(world.customers.get(1)!.keyId).toBeNull();

    expect(await deliver(checkoutEvent('evt_2', 'cs_test_2'))).toBe(200);
    expect(mints()).toEqual(['mint_cs_test_2']);
    expect(world.keys.size).toBe(1);
    expect(world.customers.get(1)).toEqual({ keyId: 'key1', totalGb: 5 });
  });

  it('adopts the minted key when the local write failed after the provider confirmed', async () => {
    world.failComplete = 1;
    expect(await deliver(checkoutEvent('evt_3', 'cs_test_3'))).toBe(500);
    expect(world.keys.size).toBe(1);

    expect(await deliver(checkoutEvent('evt_3', 'cs_test_3'))).toBe(200);
    expect(mints()).toEqual(['mint_cs_test_3']);
    expect(world.keys.size).toBe(1);
    expect(world.customers.get(1)).toEqual({ keyId: 'key1', totalGb: 5 });
  });

  it('keeps answering 500 and sends nothing more while the outcome is uncertain', async () => {
    world.next = 'uncertain';
    expect(await deliver(checkoutEvent('evt_4', 'cs_test_4'))).toBe(500);
    expect(await deliver(checkoutEvent('evt_4', 'cs_test_4'))).toBe(500);
    expect(await deliver(checkoutEvent('evt_4', 'cs_test_4'))).toBe(500);
    expect(world.dispatches).toEqual(['mint_cs_test_4']);
    expect(world.purchases.get('cs_test_4')!.state).toBe('pending');
    expect(world.events.size).toBe(0);
  });

  it('tops up once under a new token after the provider rejected the first one', async () => {
    expect(await deliver(checkoutEvent('evt_5', 'cs_test_5'))).toBe(200);
    world.next = 'reject';
    expect(await deliver(checkoutEvent('evt_6', 'cs_test_6'))).toBe(500);

    expect(await deliver(checkoutEvent('evt_6', 'cs_test_6'))).toBe(200);
    expect(topUps()).toEqual(['topup_cs_test_6', 'topup_cs_test_6_2']);
    expect(world.keys.get('key1')!.trafficCapGB).toBe(10);
    expect(world.customers.get(1)).toEqual({ keyId: 'key1', totalGb: 10 });
  });

  it('grants once for a duplicate event and for a second event of the same session', async () => {
    expect(await deliver(checkoutEvent('evt_7', 'cs_test_7'))).toBe(200);
    expect(await deliver(checkoutEvent('evt_7', 'cs_test_7'))).toBe(200);
    expect(await deliver(checkoutEvent('evt_7b', 'cs_test_7'))).toBe(200);
    expect(world.dispatches).toEqual(['mint_cs_test_7']);
    expect(world.customers.get(1)).toEqual({ keyId: 'key1', totalGb: 5 });
  });

  it('holds a second purchase until the first one is delivered, so only one key is minted', async () => {
    world.next = 'lost';
    expect(await deliver(checkoutEvent('evt_8', 'cs_test_8'))).toBe(500);
    expect(await deliver(checkoutEvent('evt_9', 'cs_test_9'))).toBe(500);
    expect(world.dispatches).toEqual(['mint_cs_test_8']);

    expect(await deliver(checkoutEvent('evt_8', 'cs_test_8'))).toBe(200);
    expect(await deliver(checkoutEvent('evt_9', 'cs_test_9'))).toBe(200);
    expect(world.dispatches).toEqual(['mint_cs_test_8', 'topup_cs_test_9']);
    expect(world.keys.size).toBe(1);
    expect(world.keys.get('key1')!.trafficCapGB).toBe(10);
    expect(world.customers.get(1)).toEqual({ keyId: 'key1', totalGb: 10 });
  });
});
