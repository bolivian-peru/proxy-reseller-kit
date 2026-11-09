import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { proxies } from '@/lib/proxies';
import { query } from '@/lib/db';
import { fulfillPaidSession } from '@/lib/fulfillment';
import { purchaseStore } from '@/lib/fulfillment-store';
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
 *
 * The answer is 2xx only once the purchase is delivered. While delivery is
 * pending or its outcome is unknown the answer is 500, so Stripe retries, and
 * the retry continues the same delivery (see lib/fulfillment.ts).
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

  // An event is marked only after it was fully handled, so a crash or a failed
  // delivery leaves no marker and the Stripe retry runs the handler again.
  try {
    const seen = await query('SELECT 1 FROM webhook_events WHERE stripe_event_id = $1', [event.id]);
    if (seen.length > 0) {
      return NextResponse.json({ received: true, deduped: true });
    }
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(event.data.object);
    }
    // Other events acknowledged but ignored.
    await query(
      `INSERT INTO webhook_events (stripe_event_id, type) VALUES ($1, $2)
       ON CONFLICT (stripe_event_id) DO NOTHING`,
      [event.id, event.type],
    );
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`Error handling ${event.type}:`, err);
    // Non-2xx tells Stripe to retry.
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

  await fulfillPaidSession(
    { sessionId: sess.id, userId, amountCents: sess.amount_total ?? 0, gb: tier.gb, tierId: tier.id },
    purchaseStore,
    proxies.poolKeys,
  );

  console.log(
    `Provisioned ${tier.gb} GB (${config.brand.name} ${tier.id}) for user ${userId}`,
  );
}
