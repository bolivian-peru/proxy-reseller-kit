import type { PoolAccessKey, ProxiesClient } from '@proxies-sx/pool-sdk';

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

type PoolKeys = Pick<ProxiesClient['poolKeys'], 'create' | 'topUp' | 'get' | 'resume' | 'operationByToken'>;

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
 *
 * A top-up also resumes the key when cap exhaustion was the only reason it was
 * disabled, so a customer who ran out and paid can connect again.
 */
export async function fulfillPaidSession(
  paid: PaidSession,
  store: FulfillmentStore,
  poolKeys: PoolKeys,
): Promise<void> {
  const delivery = await store.claim(paid);
  if (delivery.delivered) return;
  const { token, keyId } = delivery;

  const operation = delivery.fresh ? null : await findOperation(poolKeys, token);
  if (operation?.state === 'rejected') {
    // Rejected proves no effect and ends that token for good. This is the one
    // case where a new token for the same payment is correct.
    await store.reissue(paid.sessionId, token);
    return fulfillPaidSession(paid, store, poolKeys);
  }
  // `retryable` is a transient refusal that proved no effect: the same token
  // may run again, so it is dispatched exactly like a token never admitted.
  if (operation && operation.state !== 'applied' && operation.state !== 'retryable') {
    throw new Error(`Delivery ${token} is ${operation.state} at the provider; waiting for the next retry`);
  }

  const key = operation?.state === 'applied'
    ? await readDeliveredKey(poolKeys, keyId ?? operation.targetId, token)
    : await dispatch(poolKeys, paid.userId, delivery);
  if (keyId) await resumeAfterTopUp(poolKeys, key, paid.sessionId);

  await store.complete(paid.sessionId, key.id);
}

function dispatch(
  poolKeys: PoolKeys,
  userId: number,
  { token, keyId, gb }: Extract<Delivery, { delivered: false }>,
): Promise<PoolAccessKey> {
  if (keyId) return poolKeys.topUp(keyId, { addTrafficGB: gb, idempotencyKey: token });
  return poolKeys.create({ label: `customer:${userId}`, trafficCapGB: gb, idempotencyKey: token });
}

function readDeliveredKey(poolKeys: PoolKeys, keyId: string | undefined, token: string): Promise<PoolAccessKey> {
  if (!keyId) throw new Error(`Delivery ${token} is applied but names no key`);
  return poolKeys.get(keyId);
}

/**
 * Resume a topped-up key whose only hold is `cap`. A key that is disabled for
 * any other reason (manual, expired, account or security hold) stays disabled:
 * payment adds GB, it does not clear a hold somebody else placed.
 */
async function resumeAfterTopUp(poolKeys: PoolKeys, key: PoolAccessKey, sessionId: string): Promise<void> {
  if (key.enabled) return;
  const holds = key.lifecycleHolds ?? [];
  if (holds.length !== 1 || holds[0] !== 'cap' || key.lifecycleVersion === undefined) {
    console.warn(`Key ${key.id} was topped up but stays disabled (holds: ${holds.join(', ') || 'unknown'}). Review it before enabling.`);
    return;
  }
  try {
    await poolKeys.resume(key.id, {
      expectedLifecycleVersion: key.lifecycleVersion,
      idempotencyKey: `resume_${sessionId}`,
    });
  } catch (err) {
    // A 4xx other than 429 is the provider's final answer (quota still
    // exhausted, expired, changed meanwhile). The GB is delivered, so the
    // purchase completes and the key waits for a manual resume. Anything else
    // is an unknown outcome: rethrow so the Stripe retry tries again.
    const status = (err as { status?: number }).status;
    if (!status || status < 400 || status >= 500 || status === 429) throw err;
    console.warn(`Key ${key.id} was topped up but could not be resumed: ${(err as Error).message}`);
  }
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
