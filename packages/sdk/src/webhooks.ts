import { ProxiesConfigError } from './errors';

/**
 * Webhook signature verification for receivers of Proxies.sx events.
 *
 * The platform has two webhook systems, signing differently over the exact
 * raw body (see docs/WEBHOOKS-DESIGN.md for which one you are on):
 *
 *   Self-serve reseller webhooks (`POST /v1/reseller/webhooks`) send ONLY
 *     X-Webhook-Signature: sha256=<hex HMAC-SHA256(secret, rawBody)>
 *     → {@link verifyLegacyWebhookSignature}
 *
 *   Every delivery from the platform events service (subscriptions Proxies.sx
 *   creates for you) carries two signatures:
 *     X-Proxies-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *     X-Webhook-Signature: <hex HMAC-SHA256(secret, rawBody)>   (bare hex, legacy)
 *     → {@link verifyWebhookSignature}: binding the timestamp into the MAC is
 *       what lets a receiver reject a replayed delivery.
 *
 * The legacy header has no replay protection, so a receiver on it must stay
 * idempotent on the event id.
 *
 * Both functions need the body exactly as received (`express.raw()`,
 * `await req.text()`), never a re-serialised `JSON.stringify(req.body)`.
 *
 * @since 0.10.0
 */

/** Default replay window: a delivery older or newer than this is rejected. */
export const WEBHOOK_TOLERANCE_SEC = 300;

export interface VerifyWebhookSignatureOptions {
  /** Maximum |now − t| in seconds. Default {@link WEBHOOK_TOLERANCE_SEC} (5 minutes). */
  toleranceSec?: number;
  /** Current time in milliseconds, for tests or an injected clock. Default `Date.now()`. */
  nowMs?: number;
  /**
   * Web Crypto implementation. Defaults to the global `crypto` (Node ≥ 19, Bun,
   * Deno, Workers, browsers). On Node 18 pass `webcrypto` from `node:crypto`.
   */
  crypto?: Crypto;
}

/**
 * Verify the `X-Proxies-Signature` header of a delivery.
 *
 * Resolves `true` only when the header parses, `t` is within the tolerance
 * of now and one `v1` value is the HMAC-SHA256 of `${t}.${rawBody}` under
 * `secret`. Any malformed input resolves `false`; the only throw is a
 * {@link ProxiesConfigError} when no Web Crypto implementation is available.
 *
 * @example
 * ```ts
 * app.post('/webhooks/proxies', express.raw({ type: '*\/*' }), async (req, res) => {
 *   const ok = await verifyWebhookSignature(
 *     req.body as Buffer,
 *     req.header('x-proxies-signature'),
 *     process.env.PROXIES_WEBHOOK_SECRET!,
 *   );
 *   if (!ok) return res.status(400).send('invalid signature');
 *   const event = JSON.parse(req.body.toString('utf8'));
 *   // dedupe on event.id (a delivery is retried after a non-2xx), then handle event.type
 *   res.status(204).end();
 * });
 * ```
 */
export async function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
  opts: VerifyWebhookSignatureOptions = {},
): Promise<boolean> {
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed || !secret) return false;

  const toleranceSec = opts.toleranceSec ?? WEBHOOK_TOLERANCE_SEC;
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) return false;

  const signed = concatBytes(encodeUtf8(`${parsed.timestamp}.`), toBytes(rawBody));
  return hmacMatchesAny(signed, parsed.signatures, secret, opts.crypto);
}

/**
 * Verify the `X-Webhook-Signature` header: a plain HMAC-SHA256 of the raw
 * body, sent as `sha256=<hex>` by self-serve `/v1/reseller/webhooks`
 * endpoints (the only signature they receive) and as bare hex by the events
 * service. It carries no timestamp, so it cannot detect a replayed delivery:
 * dedupe on the event id. Use {@link verifyWebhookSignature} wherever an
 * `X-Proxies-Signature` header is present.
 */
export async function verifyLegacyWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
  opts: Pick<VerifyWebhookSignatureOptions, 'crypto'> = {},
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const hex = signatureHeader.trim().replace(/^sha256=/i, '');
  return hmacMatchesAny(toBytes(rawBody), [hex], secret, opts.crypto);
}

// ────────────────────────────────────────────────────────────────────────
//  Internals
// ────────────────────────────────────────────────────────────────────────

interface ParsedSignature {
  timestamp: number;
  /**
   * Every `v1=` value in the header. The platform sends one today; accepting
   * several means a future overlapping-secret rotation needs no client change.
   */
  signatures: string[];
}

function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (!header) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === 't' && /^\d{1,12}$/.test(value)) timestamp = Number(value);
    if (name === 'v1') signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * `true` when one candidate hex digest is the HMAC-SHA256 of `data`.
 * `subtle.verify` compares in constant time; an unparseable candidate is
 * skipped rather than compared.
 */
async function hmacMatchesAny(
  data: Bytes,
  candidates: string[],
  secret: string,
  cryptoImpl: Crypto | undefined,
): Promise<boolean> {
  const subtle = resolveSubtle(cryptoImpl);
  const key = await subtle.importKey(
    'raw',
    encodeUtf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  for (const candidate of candidates) {
    const signature = hexToBytes(candidate);
    if (!signature) continue;
    if (await subtle.verify('HMAC', key, signature, data)) return true;
  }
  return false;
}

function resolveSubtle(cryptoImpl: Crypto | undefined): SubtleCrypto {
  const impl = cryptoImpl ?? globalThis.crypto;
  if (!impl || !impl.subtle) {
    throw new ProxiesConfigError(
      'verifyWebhookSignature: no Web Crypto implementation. Use Node ≥ 19, or pass ' +
        "{ crypto: webcrypto } from 'node:crypto' in the options.",
    );
  }
  return impl.subtle;
}

/** Bytes backed by a plain ArrayBuffer, which is what Web Crypto accepts. */
type Bytes = Uint8Array<ArrayBuffer>;

/** 64 lowercase/uppercase hex chars → 32 bytes; anything else → null. */
function hexToBytes(hex: string): Bytes | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function encodeUtf8(s: string): Bytes {
  return new TextEncoder().encode(s);
}

/** A Node `Buffer` may be a view into a shared pool; copying gives Web Crypto its own buffer. */
function toBytes(body: string | Uint8Array): Bytes {
  return typeof body === 'string' ? encodeUtf8(body) : new Uint8Array(body);
}

function concatBytes(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
