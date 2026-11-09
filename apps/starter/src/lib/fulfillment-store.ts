import { pool, query } from '@/lib/db';
import { operationToken, type FulfillmentStore } from '@/lib/fulfillment';

/**
 * Delivery journal on the `purchases` table (see db/schema.sql).
 *
 * The provider call happens between `claim` and `complete`, outside any
 * transaction. Single-flight per customer is enforced in the database: the
 * token is assigned under the customer row lock, and only while no other
 * purchase of that customer is dispatched and undelivered.
 */
export const purchaseStore: FulfillmentStore = {
  async claim(paid) {
    await query(
      `INSERT INTO purchases (user_id, stripe_session_id, amount_usd_cents, gb_purchased, tier_id, delivery_state)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (stripe_session_id) DO NOTHING`,
      [paid.userId, paid.sessionId, paid.amountCents, paid.gb, paid.tierId],
    );
    await query(
      `INSERT INTO customers (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING`,
      [paid.userId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const customer = await client.query<{ pak_key_id: string | null }>(
        'SELECT pak_key_id FROM customers WHERE user_id = $1 FOR UPDATE',
        [paid.userId],
      );
      const purchase = await client.query<{
        delivery_state: string;
        operation_token: string | null;
        delivery_attempt: number;
        gb_purchased: string;
      }>(
        `SELECT delivery_state, operation_token, delivery_attempt, gb_purchased
           FROM purchases WHERE stripe_session_id = $1`,
        [paid.sessionId],
      );
      const row = purchase.rows[0];
      if (row.delivery_state === 'delivered') {
        await client.query('COMMIT');
        return { delivered: true };
      }

      const keyId = customer.rows[0].pak_key_id;
      let token = row.operation_token;
      const fresh = !token;
      if (!token) {
        const busy = await client.query(
          `SELECT 1 FROM purchases
            WHERE user_id = $1 AND delivery_state = 'pending' AND operation_token IS NOT NULL
            LIMIT 1`,
          [paid.userId],
        );
        if (busy.rows.length > 0) {
          throw new Error(`Another purchase of user ${paid.userId} is still being delivered`);
        }
        token = operationToken(keyId, paid.sessionId, row.delivery_attempt);
        await client.query(
          'UPDATE purchases SET operation_token = $1 WHERE stripe_session_id = $2',
          [token, paid.sessionId],
        );
      }
      await client.query('COMMIT');
      return { delivered: false, token, fresh, keyId, gb: Number(row.gb_purchased) };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },

  async reissue(sessionId, rejectedToken) {
    await query(
      `UPDATE purchases
          SET operation_token = NULL, delivery_attempt = delivery_attempt + 1
        WHERE stripe_session_id = $1 AND operation_token = $2 AND delivery_state = 'pending'`,
      [sessionId, rejectedToken],
    );
  },

  async complete(sessionId, keyId) {
    // One statement: the purchase flips to delivered and the customer row is
    // credited together, and a second caller for the same session changes nothing.
    await query(
      `WITH done AS (
         UPDATE purchases SET delivery_state = 'delivered'
          WHERE stripe_session_id = $1 AND delivery_state = 'pending'
          RETURNING user_id, gb_purchased
       )
       UPDATE customers c
          SET pak_key_id = $2,
              total_gb_purchased = c.total_gb_purchased + done.gb_purchased,
              updated_at = NOW()
         FROM done
        WHERE c.user_id = done.user_id`,
      [sessionId, keyId],
    );
  },
};
