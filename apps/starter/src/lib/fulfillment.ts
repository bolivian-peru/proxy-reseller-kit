import type { ProxiesClient } from '@proxies-sx/pool-sdk';

/** A paid Stripe checkout session, as recorded in `purchases`. */
export interface PaidSession {
  sessionId: string;
  userId: number;
  amountCents: number;
  gb: number;
  tierId: string;
}

/** Delivery state of one purchase, read under the customer row lock. */
export type Delivery =
  | { delivered: true }
  | {
      delivered: false;
      /** Idempotency-Key of the provider operation. Stored before any dispatch. */
      token: string;
      /** True when this call assigned the token, so nothing was sent under it yet. */
      fresh: boolean;
      /** The customer's key id, or null before the first mint. */
      keyId: string | null;
      gb: number;
    };

/** The delivery journal. The starter keeps it on the `purchases` row. */
export interface FulfillmentStore {
  /**
   * Record the paid session as pending (once) and return its delivery state.
   * Throws while another purchase of the same customer is dispatched and not
   * yet delivered, so two sessions can never mint two keys.
   */
  claim(paid: PaidSession): Promise<Delivery>;
  /** Retire a token the provider rejected, so the next claim assigns a new one. */
  reissue(sessionId: string, rejectedToken: string): Promise<void>;
  /** Mark the purchase delivered and credit the customer row, exactly once. */
  complete(sessionId: string, keyId: string): Promise<void>;
}

type PoolKeys = Pick<ProxiesClient['poolKeys'], 'create' | 'topUp' | 'operationByToken'>;

/** Idempotency-Key for the provider operation that delivers one checkout session. */
export function operationToken(keyId: string | null, sessionId: string, attempt: number): string {
  const base = `${keyId ? 'topup' : 'mint'}_${sessionId}`;
  return attempt > 1 ? `${base}_${attempt}` : base;
}

/**
 * Deliver a paid checkout session: mint the customer's key or top it up.
 *
 * Resolves only when the provider has confirmed the operation and the purchase
 * is marked delivered. Any other outcome throws, the webhook answers non-2xx
 * and Stripe retries. A retry reads the operation stored under the same token
 * before it sends anything, so a session is never delivered twice.
 */
export async function fulfillPaidSession(
  paid: PaidSession,
  store: FulfillmentStore,
  poolKeys: PoolKeys,
): Promise<void> {
  const delivery = await store.claim(paid);
  if (delivery.delivered) return;
  const { token, keyId, gb } = delivery;

  const operation = delivery.fresh ? null : await findOperation(poolKeys, token);
  if (operation?.state === 'rejected') {
    // Rejected proves no effect and ends that token for good. This is the one
    // case where a new token for the same payment is correct.
    await store.reissue(paid.sessionId, token);
    return fulfillPaidSession(paid, store, poolKeys);
  }
  if (operation && operation.state !== 'applied') {
    throw new Error(`Delivery ${token} is ${operation.state} at the provider; waiting for the next retry`);
  }

  let deliveredKeyId = keyId ?? operation?.targetId;
  if (!operation) {
    const dispatched = keyId
      ? await poolKeys.topUp(keyId, { addTrafficGB: gb, idempotencyKey: token })
      : await poolKeys.create({ label: `customer:${paid.userId}`, trafficCapGB: gb, idempotencyKey: token });
    deliveredKeyId = dispatched.id;
  }
  if (!deliveredKeyId) throw new Error(`Delivery ${token} is applied but names no key`);

  await store.complete(paid.sessionId, deliveredKeyId);
}

/** The operation stored under a token, or null when the provider never admitted one. */
async function findOperation(poolKeys: PoolKeys, token: string) {
  try {
    return await poolKeys.operationByToken(token);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}
