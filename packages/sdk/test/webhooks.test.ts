import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyWebhookSignature,
  verifyLegacyWebhookSignature,
  WEBHOOK_TOLERANCE_SEC,
} from '../src/webhooks';
import { ProxiesConfigError } from '../src/errors';

const SECRET = 'whsec_test_0123456789';
const BODY = JSON.stringify({
  id: '672c0f1e9a1b2c3d4e5f6a7b',
  type: 'ping',
  createdAt: '2026-11-07T10:00:00.000Z',
  data: {},
});
const NOW_MS = Date.parse('2026-11-07T10:00:05.000Z');
const NOW_SEC = Math.floor(NOW_MS / 1000);

/** The platform's signing: HMAC-SHA256(secret, `${t}.${rawBody}`) as hex. */
function sign(t: number, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
}

function header(t: number, body = BODY, secret = SECRET): string {
  return `t=${t},v1=${sign(t, body, secret)}`;
}

describe('verifyWebhookSignature (X-Proxies-Signature)', () => {
  it('accepts a correctly signed body inside the tolerance', async () => {
    expect(await verifyWebhookSignature(BODY, header(NOW_SEC), SECRET, { nowMs: NOW_MS })).toBe(true);
  });

  it('accepts the body as bytes (express.raw / Buffer) identically to the string', async () => {
    const bytes = new TextEncoder().encode(BODY);
    expect(await verifyWebhookSignature(bytes, header(NOW_SEC), SECRET, { nowMs: NOW_MS })).toBe(true);
    expect(await verifyWebhookSignature(Buffer.from(BODY), header(NOW_SEC), SECRET, { nowMs: NOW_MS })).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const tampered = BODY.replace('ping', 'pong');
    expect(await verifyWebhookSignature(tampered, header(NOW_SEC), SECRET, { nowMs: NOW_MS })).toBe(false);
  });

  it('rejects the wrong secret', async () => {
    expect(await verifyWebhookSignature(BODY, header(NOW_SEC), 'whsec_other_secret', { nowMs: NOW_MS })).toBe(false);
  });

  it('rejects a signature over a different timestamp than the one in the header', async () => {
    const forged = `t=${NOW_SEC},v1=${sign(NOW_SEC - 1, BODY)}`;
    expect(await verifyWebhookSignature(BODY, forged, SECRET, { nowMs: NOW_MS })).toBe(false);
  });

  it('rejects deliveries outside the 5-minute replay window, past or future', async () => {
    const old = NOW_SEC - WEBHOOK_TOLERANCE_SEC - 1;
    const future = NOW_SEC + WEBHOOK_TOLERANCE_SEC + 1;
    expect(await verifyWebhookSignature(BODY, header(old), SECRET, { nowMs: NOW_MS })).toBe(false);
    expect(await verifyWebhookSignature(BODY, header(future), SECRET, { nowMs: NOW_MS })).toBe(false);
    // exactly on the edge is still accepted
    const edge = NOW_SEC - WEBHOOK_TOLERANCE_SEC;
    expect(await verifyWebhookSignature(BODY, header(edge), SECRET, { nowMs: NOW_MS })).toBe(true);
  });

  it('honours a custom toleranceSec', async () => {
    const t = NOW_SEC - 30;
    expect(await verifyWebhookSignature(BODY, header(t), SECRET, { nowMs: NOW_MS, toleranceSec: 10 })).toBe(false);
    expect(await verifyWebhookSignature(BODY, header(t), SECRET, { nowMs: NOW_MS, toleranceSec: 60 })).toBe(true);
  });

  it('accepts when any one v1 matches (secret rotation sends two)', async () => {
    const h = `t=${NOW_SEC},v1=${'0'.repeat(64)},v1=${sign(NOW_SEC, BODY)}`;
    expect(await verifyWebhookSignature(BODY, h, SECRET, { nowMs: NOW_MS })).toBe(true);
  });

  it('returns false (never throws) on a missing or malformed header', async () => {
    for (const h of [undefined, null, '', 'garbage', `v1=${sign(NOW_SEC, BODY)}`, `t=${NOW_SEC}`, `t=abc,v1=zz`, `t=${NOW_SEC},v1=notHex`]) {
      expect(await verifyWebhookSignature(BODY, h, SECRET, { nowMs: NOW_MS })).toBe(false);
    }
  });

  it('returns false on an empty secret', async () => {
    expect(await verifyWebhookSignature(BODY, header(NOW_SEC), '', { nowMs: NOW_MS })).toBe(false);
  });

  it('throws ProxiesConfigError when no Web Crypto implementation is available', async () => {
    await expect(
      verifyWebhookSignature(BODY, header(NOW_SEC), SECRET, { nowMs: NOW_MS, crypto: {} as Crypto }),
    ).rejects.toBeInstanceOf(ProxiesConfigError);
  });

  it('uses the real clock by default', async () => {
    const t = Math.floor(Date.now() / 1000);
    expect(await verifyWebhookSignature(BODY, header(t), SECRET)).toBe(true);
  });
});

describe('verifyLegacyWebhookSignature (X-Webhook-Signature)', () => {
  const legacy = createHmac('sha256', SECRET).update(BODY).digest('hex');

  it('accepts the bare hex form sent by the events service', async () => {
    expect(await verifyLegacyWebhookSignature(BODY, legacy, SECRET)).toBe(true);
  });

  it('accepts the sha256= prefixed form sent by the older reseller webhooks', async () => {
    expect(await verifyLegacyWebhookSignature(BODY, `sha256=${legacy}`, SECRET)).toBe(true);
    expect(await verifyLegacyWebhookSignature(Buffer.from(BODY), `sha256=${legacy}`, SECRET)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and a missing header', async () => {
    expect(await verifyLegacyWebhookSignature(BODY + ' ', legacy, SECRET)).toBe(false);
    expect(await verifyLegacyWebhookSignature(BODY, legacy, 'whsec_other_secret')).toBe(false);
    expect(await verifyLegacyWebhookSignature(BODY, undefined, SECRET)).toBe(false);
    expect(await verifyLegacyWebhookSignature(BODY, 'sha256=nope', SECRET)).toBe(false);
  });
});
