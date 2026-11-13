import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FulfillmentStore, PaidSession } from '@/lib/fulfillment';

/**
 * Runs the real SQL of the delivery journal. Needs a disposable Postgres:
 *   TEST_DATABASE_URL=postgres://... pnpm test
 * Skipped when the variable is not set. CI provides one.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('purchases delivery journal (Postgres)', () => {
  let db: typeof import('@/lib/db');
  let store: FulfillmentStore;
  let userId: number;
  const paid = (sessionId: string): PaidSession => ({ sessionId, userId, amountCents: 3500, gb: 5, tierId: 'starter' });
  const customer = () => db.queryOne('SELECT pak_key_id, total_gb_purchased::float AS total FROM customers WHERE user_id = $1', [userId]);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = await import('@/lib/db');
    store = (await import('@/lib/fulfillment-store')).purchaseStore;
    await db.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  });
  beforeEach(async () => {
    await db.query('TRUNCATE users CASCADE');
    userId = (await db.queryOne<{ id: number }>(`INSERT INTO users (email) VALUES ('a@example.com') RETURNING id`))!.id;
  });
  afterAll(async () => {
    await db?.pool.end();
  });

  it('stores the token on the first claim and returns the same token on a retry', async () => {
    expect(await store.claim(paid('cs_a'))).toEqual({ delivered: false, token: 'mint_cs_a', fresh: true, keyId: null, gb: 5 });
    expect(await store.claim(paid('cs_a'))).toEqual({ delivered: false, token: 'mint_cs_a', fresh: false, keyId: null, gb: 5 });
  });

  it('lets only one of two concurrent first purchases start delivery', async () => {
    const results = await Promise.allSettled([store.claim(paid('cs_a')), store.claim(paid('cs_b'))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('credits the customer once, then hands the next purchase a top-up token', async () => {
    await store.claim(paid('cs_a'));
    await store.complete('cs_a', 'key1');
    await store.complete('cs_a', 'key1');
    expect(await customer()).toEqual({ pak_key_id: 'key1', total: 5 });
    expect(await store.claim(paid('cs_a'))).toEqual({ delivered: true });
    expect(await store.claim(paid('cs_b'))).toMatchObject({ token: 'topup_cs_b', fresh: true, keyId: 'key1' });
  });

  it('assigns a new token after a rejected one is retired', async () => {
    await store.claim(paid('cs_a'));
    await store.reissue('cs_a', 'mint_cs_a');
    await store.reissue('cs_a', 'mint_cs_a');
    expect(await store.claim(paid('cs_a'))).toMatchObject({ token: 'mint_cs_a_2', fresh: true });
  });

  it('treats a purchase written before the journal existed as delivered', async () => {
    await db.query(
      `INSERT INTO purchases (user_id, stripe_session_id, amount_usd_cents, gb_purchased, tier_id)
       VALUES ($1, 'cs_old', 3500, 5, 'starter')`,
      [userId],
    );
    expect(await store.claim(paid('cs_old'))).toEqual({ delivered: true });
  });
});
