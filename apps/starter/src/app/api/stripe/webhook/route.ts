import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { proxies } from '@/lib/proxies';
import { pool, query } from '@/lib/db';
import { tierById, config } from '@/config';

// Stripe signs the raw body; never parse before verifying.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Stripe webhook endpoint.
 *
 * Configure in Stripe dashboard:
 *   Endpoint URL: https://YOUR_DOMAIN/api/stripe/webhook
 *   Events: checkout.session.completed
 *
 * For local dev: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 });

  // Raw body required for signature verification.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // Idempotency: try to insert the event id. If it's already there, skip.
  try {
    await query(
      'INSERT INTO webhook_events (stripe_event_id, type) VALUES ($1, $2)',
      [event.id, event.type],
    );
  } catch (err) {
    // Duplicate → already processed. Acknowledge 200 so Stripe stops retrying.
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ received: true, deduped: true });
    }
    console.error('webhook_events insert failed:', err);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object);
    }
    // Other events acknowledged but ignored.
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    // Non-2xx tells Stripe to retry. Delete our idempotency marker so the retry
    // actually runs the handler again instead of being silently deduped.
    await query('DELETE FROM webhook_events WHERE stripe_event_id = $1', [event.id]).catch(() => {});
    return NextResponse.json({ error: 'handler_failed' }, { status: 500 });
  }
}

async function handleCheckoutCompleted(sess: Stripe.Checkout.Session): Promise<void> {
  const userIdStr = sess.metadata?.userId;
  const tierId = sess.metadata?.tierId;
  if (!userIdStr || !tierId) {
    console.warn('Missing userId/tierId in checkout metadata; skipping');
    return;
  }
  const userId = Number(userIdStr);
  const tier = tierById(tierId);
  const paidCents = sess.amount_total ?? 0;

  // Atomic: if this stripe_session_id was already processed we'll get a
  // unique-violation and stop here (makes retries safe).
  const inserted = await query(
    `INSERT INTO purchases (user_id, stripe_session_id, amount_usd_cents, gb_purchased, tier_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (stripe_session_id) DO NOTHING
     RETURNING id`,
    [userId, sess.id, paidCents, tier.gb, tier.id],
  );
  if (inserted.length === 0) {
    return; // Already processed
  }

  // Ensure a customers row exists.
  await query(
    `INSERT INTO customers (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );

  // Lock the customer row + mint/topup + write back, all inside one
  // transaction. Without this, two near-simultaneous checkouts for the
  // same user can BOTH read pak_key_id IS NULL, mint TWO keys with
  // different idempotency keys, and the second UPDATE wins — orphaning
  // the first paid-for key. (`FOR UPDATE` blocks the second webhook
  // until the first commits.)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const lockRes = await client.query<{
      pak_key_id: string | null;
      total_gb_purchased: string;
    }>(
      'SELECT pak_key_id, total_gb_purchased FROM customers WHERE user_id = $1 FOR UPDATE',
      [userId],
    );
    const customer = lockRes.rows[0] ?? null;

    const newTotalGb = Number(customer?.total_gb_purchased ?? 0) + tier.gb;

    if (!customer?.pak_key_id) {
      // First purchase — mint the key with this tier's GB as the cap.
      // idempotencyKey tied to the Stripe session id makes the SDK
      // call retry-safe; the FOR UPDATE above prevents the OTHER race
      // (two concurrent first-purchase checkouts for same user).
      const key = await proxies.poolKeys.create({
        label: `customer:${userId}`,
        trafficCapGB: newTotalGb,
        idempotencyKey: `mint_${sess.id}`,
      });
      await client.query(
        `UPDATE customers
           SET pak_key_id = $1,
               total_gb_purchased = $2,
               updated_at = NOW()
         WHERE user_id = $3`,
        [key.id, newTotalGb, userId],
      );
    } else {
      // Top-up — atomic $inc on the platform side. The local mirror
      // is updated inside the same txn so the row-lock prevents
      // stale-read undercounting on concurrent top-ups.
      await proxies.poolKeys.topUp(customer.pak_key_id, {
        addTrafficGB: tier.gb,
        idempotencyKey: `topup_${sess.id}`,
      });
      // Payment adds entitlement; it does not authorize clearing an independent
      // account, security or operator hold. Conditional resume belongs to an
      // explicit reviewed recovery flow, outside this payment callback.
      await client.query(
        `UPDATE customers
           SET total_gb_purchased = $1,
               updated_at = NOW()
         WHERE user_id = $2`,
        [newTotalGb, userId],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  console.log(
    `Provisioned ${tier.gb} GB (${config.brand.name} ${tier.id}) for user ${userId}`,
  );
}
