import type {
  ClientConfig,
  CreatePoolAccessKeyInput,
  UpdatePoolAccessKeyInput,
  TopUpPoolAccessKeyInput,
  PoolAccessKey,
  PoolAccessKeyAuditEvent,
  AuditQueryOpts,
  PoolStock,
  CarrierStock,
  Incident,
  BuildProxyUrlOpts,
  RetryConfig,
  ActiveSession,
  ActiveSessionsResponse,
  PrivateModemCatalog,
  PrivateModemsMine,
  PrivateModemOrder,
  PrivateModemCart,
  PrivateModemRenewalQuote,
  PrivateModemRotateResult,
  PrivateModemAutoRenew,
  PrivateModemPeriod,
  BuyPrivateModemInput,
  BuyPrivateModemCartInput,
  RenewPrivateModemInput,
} from './types';
import {
  ProxiesError,
  ProxiesApiError,
  ProxiesConfigError,
  ProxiesTimeoutError,
} from './errors';
import { buildProxyUrl, GATEWAY_HOST } from './url';

const DEFAULT_BASE_URL = 'https://api.proxies.sx/v1';
const DEFAULT_TIMEOUT = 30_000;

/** Defaults for {@link RetryConfig}. Picked to be conservative — 3 attempts max, ~5s total worst case. */
const DEFAULT_RETRY: Required<RetryConfig> = {
  attempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};

/** What the platform accepts as an `Idempotency-Key`: UUIDs, ULIDs, Stripe-style ids, most domain ids. */
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Primary entry point to the Proxies.sx reseller API.
 *
 * @example
 * ```ts
 * const proxies = new ProxiesClient({
 *   apiKey: process.env.PROXIES_SX_API_KEY!,
 *   proxyUsername: process.env.PROXIES_SX_USERNAME!,
 * });
 *
 * const key = await proxies.poolKeys.create({
 *   label: 'customer:alice',
 *   trafficCapGB: 10,
 *   idempotencyKey: `mint_${customerId}`,  // tie to your domain
 * });
 *
 * const url = proxies.buildProxyUrl(key.key, { country: 'us', rotation: 'sticky' });
 * ```
 */
export class ProxiesClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly gatewayHost: string;
  private readonly timeout: number;
  private readonly fetchImpl: typeof fetch;
  private readonly retry: Required<RetryConfig> | null;

  /** Your reseller `proxyUsername`, e.g. `psx_abc123`. Set at construction time. */
  public readonly proxyUsername: string | undefined;

  /** Pool Access Key operations. */
  public readonly poolKeys: PoolKeysApi;

  /** Pool health / stock / incident feeds (public, unauthenticated). */
  public readonly pool: PoolApi;

  /** Live gateway session list + close operations for the current user. @since 0.4.0 */
  public readonly sessions: SessionsApi;

  /** Private modems: dedicated 4G/5G modems rented per day, week or month. @since 0.10.0 */
  public readonly privateModems: PrivateModemsApi;

  constructor(config: ClientConfig) {
    if (!config.apiKey) {
      throw new ProxiesConfigError('ProxiesClient: apiKey is required');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.gatewayHost = config.gatewayHost ?? GATEWAY_HOST;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.proxyUsername = config.proxyUsername;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new ProxiesConfigError(
        'ProxiesClient: global fetch is unavailable. Pass a `fetch` implementation in config.',
      );
    }

    // Retry: false → null (disabled). Object → merged with defaults. Undefined → defaults.
    if (config.retry === false) {
      this.retry = null;
    } else {
      this.retry = { ...DEFAULT_RETRY, ...(config.retry ?? {}) };
      if (this.retry.attempts < 1) this.retry.attempts = 1;
    }

    this.poolKeys = new PoolKeysApi(this);
    this.pool = new PoolApi(this);
    this.sessions = new SessionsApi(this);
    this.privateModems = new PrivateModemsApi(this);
  }

  /**
   * Build a customer-facing proxy URL. Sugar over the standalone
   * {@link buildProxyUrl} helper, using the `proxyUsername` and `gatewayHost`
   * from this client's config.
   *
   * @throws {ProxiesConfigError} if `proxyUsername` wasn't set on the client.
   */
  buildProxyUrl(pakKey: string, opts: BuildProxyUrlOpts = {}): string {
    if (!this.proxyUsername) {
      throw new ProxiesConfigError(
        'ProxiesClient.buildProxyUrl: proxyUsername must be set in ClientConfig',
      );
    }
    return buildProxyUrl(this.proxyUsername, pakKey, {
      ...opts,
      host: opts.host ?? this.gatewayHost,
    });
  }

  /**
   * @internal Low-level request used by the sub-APIs. Not stable API.
   *
   * Only a request that is safe to re-send is retried: a GET, or a write that
   * carries an `Idempotency-Key`. The same `init` (and so the same header
   * object and key) is passed to every attempt — a key is never generated
   * inside the loop, so a retry can only ever replay, never repeat, a charge.
   * The key is also stamped on the error that finally surfaces
   * ({@link ProxiesError.idempotencyKey}) so the caller can replay it.
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const idempotencyKey = idempotencyKeyOf(init.headers);
    const attempts = isRetrySafe(init, idempotencyKey) ? this.retry?.attempts ?? 1 : 1;
    let lastErr: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.requestOnce<T>(path, init);
      } catch (err) {
        lastErr = err;
        if (idempotencyKey && err instanceof ProxiesError) err.idempotencyKey = idempotencyKey;
        if (!this.shouldRetry(err) || attempt === attempts - 1) {
          throw err;
        }
        const delay = this.computeBackoff(err, attempt);
        await sleep(delay);
      }
    }
    // Unreachable — the loop always throws or returns — but keeps TS happy.
    throw lastErr;
  }

  /** @internal Single attempt, no retry logic. Visible for testing. */
  async requestOnce<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    const headers: Record<string, string> = {
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': `@proxies-sx/pool-sdk/${VERSION}`,
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (init.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, headers, signal: controller.signal });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new ProxiesTimeoutError(this.timeout);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let data: unknown = undefined;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        // Leave `data` undefined; raw `body` still available on the error.
      }
    }

    const requestId = res.headers.get('x-request-id') ?? undefined;

    if (!res.ok) {
      const err = new ProxiesApiError(res.status, text, data, requestId);
      // Stash Retry-After on the error so the retry loop can read it without re-parsing.
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter !== null) {
        (err as ProxiesApiError & { retryAfterMs?: number }).retryAfterMs =
          parseRetryAfter(retryAfter);
      }
      throw err;
    }
    return data as T;
  }

  /** @internal Predicate the retry loop uses to classify a thrown error. */
  private shouldRetry(err: unknown): boolean {
    if (!this.retry) return false;
    if (err instanceof ProxiesTimeoutError) return true;
    if (err instanceof ProxiesApiError) {
      // 429 + 5xx are retryable. 4xx (other than 429) are programmer errors.
      return err.status === 429 || err.status >= 500;
    }
    // Network-level errors (TypeError on fetch, etc.). Treat as transient.
    if (err instanceof Error && err.name !== 'AbortError') return true;
    return false;
  }

  /** @internal Compute backoff for the next attempt. Honors Retry-After when present. */
  private computeBackoff(err: unknown, attempt: number): number {
    const cfg = this.retry!;
    const retryAfterMs =
      err instanceof ProxiesApiError
        ? (err as ProxiesApiError & { retryAfterMs?: number }).retryAfterMs
        : undefined;
    if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
      return Math.min(retryAfterMs, cfg.maxDelayMs);
    }
    const exp = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * 2 ** attempt);
    // Full jitter: a uniform random in [0, exp). Avoids thundering herd.
    return Math.floor(Math.random() * exp);
  }
}

/** Pool Access Key CRUD. */
export class PoolKeysApi {
  constructor(private readonly client: ProxiesClient) {}

  /**
   * Mint a new Pool Access Key. Returns the full key record including the secret `key`.
   *
   * Every call carries an `Idempotency-Key`: the one you pass, or one the SDK
   * generates for this call (since 0.10.0). The SDK's own retries reuse it, so a
   * network blip never mints a second key. Pass a deterministic id tied to a
   * domain object (a `payment_intent_id`) so your own app-level retries dedupe
   * too. Idempotency keys live for 24h.
   *
   * If the call still fails with a {@link ProxiesTimeoutError} or a 5xx, the
   * outcome is unknown: replay it with `idempotencyKey: err.idempotencyKey`,
   * or look the operation up at `GET /v1/reseller/pool-keys/operations/lookup`
   * (header `Idempotency-Key: <that key>`). Calling again without the key can
   * mint a second key.
   *
   * @example
   * ```ts
   * // In your Stripe webhook handler:
   * const key = await proxies.poolKeys.create({
   *   label: `customer:${session.customer}`,
   *   trafficCapGB: 10,
   *   expiresAt: new Date(Date.now() + 60 * 86400_000),
   *   idempotencyKey: session.id,  // Stripe checkout session id
   * });
   * ```
   */
  async create(input: CreatePoolAccessKeyInput): Promise<PoolAccessKey> {
    if (!input.label) {
      throw new ProxiesConfigError('poolKeys.create: label is required');
    }
    // Strip idempotencyKey from the body (it's a header, not a field).
    const { idempotencyKey, ...body } = input;
    return this.client.request<PoolAccessKey>('/reseller/pool-keys', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: idempotencyHeader('poolKeys.create', idempotencyKey),
    });
  }

  /** List all your Pool Access Keys with current usage. */
  list(): Promise<PoolAccessKey[]> {
    return this.client.request<PoolAccessKey[]>('/reseller/pool-keys');
  }

  /**
   * Fetch a single key by id. Cheaper than `list()` + filter when you
   * already have an id (e.g. from your own DB).
   *
   * @throws {ProxiesApiError} 404 if the key doesn't exist or belongs to
   *   another reseller.
   *
   * @since 0.3.0
   */
  async get(keyId: string): Promise<PoolAccessKey> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.get: keyId is required');
    return this.client.request<PoolAccessKey>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}`,
    );
  }

  /**
   * Update a key. Any field left undefined is untouched.
   *
   * @remarks Setting `enabled: false` takes effect immediately — in-flight
   *   gateway sessions using this key are rejected on the next auth check.
   *
   *   For top-ups (extending an existing credit), prefer {@link topUp}
   *   over `update` — it's a single atomic write that handles
   *   `expiresAt = max(now, current) + days` server-side, avoiding the
   *   read-modify-write race when concurrent top-ups land on the same key.
   *
   *   Every call carries an `Idempotency-Key` (yours or one generated per call,
   *   since 0.10.0), so the SDK keeps retrying a transient failure as it did
   *   before 0.10.0 and the platform applies the change once.
   */
  async update(keyId: string, input: UpdatePoolAccessKeyInput): Promise<PoolAccessKey> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.update: keyId is required');
    const { idempotencyKey, ...body } = input;
    return this.client.request<PoolAccessKey>(`/reseller/pool-keys/${encodeURIComponent(keyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: idempotencyHeader('poolKeys.update', idempotencyKey),
    });
  }

  /**
   * Top up a key with additional GB and/or extended expiry, atomically.
   *
   * - `addTrafficGB` is added to the current cap server-side via a single
   *   `$inc`. If the existing cap is `null` (unbounded), it stays `null`.
   * - `extendDays` extends `expiresAt` from `max(now, current_expiresAt)` —
   *   never shortens. If the key has no expiry, sets one to `now + days`.
   *
   * Pass `idempotencyKey` (e.g. your invoice id) to make the call safe to
   * retry — duplicate calls with the same key return the same result.
   *
   * @example
   * ```ts
   * // Customer paid for another 10 GB and another 30 days:
   * const updated = await proxies.poolKeys.topUp(keyId, {
   *   addTrafficGB: 10,
   *   extendDays: 30,
   *   idempotencyKey: `topup_${invoiceId}`,
   * });
   * console.log(updated.trafficCapGB, updated.expiresAt);
   * ```
   *
   * @since 0.3.0
   */
  async topUp(keyId: string, input: TopUpPoolAccessKeyInput): Promise<PoolAccessKey> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.topUp: keyId is required');
    if (input.addTrafficGB === undefined && input.extendDays === undefined) {
      throw new ProxiesConfigError(
        'poolKeys.topUp: must pass at least one of addTrafficGB or extendDays',
      );
    }
    if (input.addTrafficGB !== undefined && input.addTrafficGB <= 0) {
      throw new ProxiesConfigError('poolKeys.topUp: addTrafficGB must be > 0');
    }
    if (input.extendDays !== undefined && input.extendDays <= 0) {
      throw new ProxiesConfigError('poolKeys.topUp: extendDays must be > 0');
    }
    const { idempotencyKey, ...body } = input;
    return this.client.request<PoolAccessKey>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}/topup`,
      { method: 'POST', body: JSON.stringify(body), headers: idempotencyHeader('poolKeys.topUp', idempotencyKey) },
    );
  }

  /**
   * Rotate the secret value of a key. Use this if the old value was leaked.
   * The previous `pak_` value is invalidated immediately.
   *
   * Pass `idempotencyKey` to make the call safe to retry — duplicate
   * regenerate calls with the same key return the same new value, instead
   * of rotating twice.
   *
   * @returns The full key record with the new `key` field.
   *   (Until 0.3.0 this returned `{id, key}` only — the old fields are
   *   still present for backward compat.)
   */
  async regenerate(
    keyId: string,
    opts: { idempotencyKey?: string } = {},
  ): Promise<PoolAccessKey> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.regenerate: keyId is required');
    return this.client.request<PoolAccessKey>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}/regenerate`,
      { method: 'POST', headers: idempotencyHeader('poolKeys.regenerate', opts.idempotencyKey) },
    );
  }

  /** Permanently delete a key. Cannot be undone. */
  async delete(keyId: string): Promise<void> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.delete: keyId is required');
    await this.client.request<{ message: string }>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Audit-logged unmask. Returns the same record as {@link get}, AND
   * records a `reveal` event in the platform audit log with the caller's
   * IP, UA, and request id. Use this in your customer-facing dashboards
   * instead of displaying the raw `key` field from {@link list} — gives
   * you forensic visibility into "who exfiltrated my key" investigations
   * even when the action is legitimate.
   *
   * Pattern: list returns prefix-only display (mask `pak_xxxx…xxxx`),
   * "Reveal" button → confirm dialog → call this method → show full
   * value once + copy-to-clipboard. Mirror of how Stripe / GitHub /
   * AWS handle credential display.
   *
   * @example
   * ```ts
   * // In your "Reveal" handler:
   * const fresh = await proxies.poolKeys.reveal(keyId);
   * showSecret(fresh.key);  // briefly, with auto-hide
   * ```
   *
   * @since 0.5.0
   */
  async reveal(keyId: string): Promise<PoolAccessKey> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.reveal: keyId is required');
    return this.client.request<PoolAccessKey>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}/reveal`,
      { method: 'POST' },
    );
  }

  /**
   * Forensic audit log across all of your pool access keys. Returns
   * events newest-first. Server retains for 90 days — archive to your
   * own SIEM if you need longer retention.
   *
   * Use cases:
   * - "Did anyone modify keys today?" → leave `action` unset
   * - "Show every gateway-auth failure" → `{ action: 'gateway_auth_failure' }`
   *   (catches credential stuffing — many failures across many IPs on
   *   one pak signal a leaked key being attacked)
   * - "Show every auto-suspend so we can review caps"
   *   → `{ action: 'auto_suspended_cap_exceeded' }`
   * - Pagination: `{ before: oldestSeenAt, limit: 100 }`
   *
   * @example
   * ```ts
   * // Last 50 state-changing events:
   * const events = await proxies.poolKeys.audit({ limit: 50 });
   *
   * // Specific action filter:
   * const suspends = await proxies.poolKeys.audit({
   *   action: 'auto_suspended_cap_exceeded',
   *   limit: 200,
   * });
   * ```
   *
   * @since 0.5.0
   */
  async audit(opts: AuditQueryOpts = {}): Promise<PoolAccessKeyAuditEvent[]> {
    const qs = new URLSearchParams();
    if (opts.action) qs.set('action', opts.action);
    if (opts.before) {
      const iso = opts.before instanceof Date ? opts.before.toISOString() : opts.before;
      qs.set('before', iso);
    }
    if (opts.limit !== undefined) {
      if (opts.limit <= 0) {
        throw new ProxiesConfigError('poolKeys.audit: limit must be > 0');
      }
      qs.set('limit', String(opts.limit));
    }
    const tail = qs.toString();
    return this.client.request<PoolAccessKeyAuditEvent[]>(
      `/reseller/pool-keys/audit${tail ? '?' + tail : ''}`,
    );
  }

  /**
   * Forensic audit log scoped to a single pool access key.
   * Same payload shape as {@link audit} but the `pakId` field is
   * omitted from each event (redundant when scoped by id in the URL).
   *
   * Use cases:
   * - Customer says "my key stopped working" → look at recent
   *   `gateway_auth_failure` + `auto_suspended_*` events
   * - Reconstruct a compromised key's lifecycle for incident review
   *
   * @example
   * ```ts
   * const events = await proxies.poolKeys.auditForKey(keyId, { limit: 50 });
   * const lastSuspend = events.find(e =>
   *   e.action === 'auto_suspended_cap_exceeded' ||
   *   e.action === 'auto_suspended_expired',
   * );
   * if (lastSuspend) {
   *   console.log('Suspended at', lastSuspend.createdAt, 'because', lastSuspend.metadata);
   * }
   * ```
   *
   * @since 0.5.0
   */
  async auditForKey(
    keyId: string,
    opts: Omit<AuditQueryOpts, 'action'> = {},
  ): Promise<PoolAccessKeyAuditEvent[]> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.auditForKey: keyId is required');
    const qs = new URLSearchParams();
    if (opts.before) {
      const iso = opts.before instanceof Date ? opts.before.toISOString() : opts.before;
      qs.set('before', iso);
    }
    if (opts.limit !== undefined) {
      if (opts.limit <= 0) {
        throw new ProxiesConfigError('poolKeys.auditForKey: limit must be > 0');
      }
      qs.set('limit', String(opts.limit));
    }
    const tail = qs.toString();
    return this.client.request<PoolAccessKeyAuditEvent[]>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}/audit${tail ? '?' + tail : ''}`,
    );
  }
}

/** Public, unauthenticated pool-level endpoints. */
export class PoolApi {
  constructor(private readonly client: ProxiesClient) {}

  /**
   * Live online-endpoint count per country. Safe to call from clients
   * (auth header is still sent but the endpoint itself is public).
   * Cached server-side for 30s.
   *
   * Runtime-validates the response envelope so a server-side shape
   * change throws a typed `ProxiesError` rather than returning data
   * the caller iterates as `undefined`.
   */
  async getStock(): Promise<PoolStock> {
    const raw = await this.client.request<unknown>('/gateway/pool/stock');
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('pools' in raw) ||
      !('totals' in raw) ||
      !('generatedAt' in raw) ||
      typeof (raw as any).pools !== 'object' ||
      typeof (raw as any).totals !== 'object'
    ) {
      throw new ProxiesError(
        'PoolStock response shape unexpected — possible upstream change. ' +
          'Got: ' +
          JSON.stringify(raw).slice(0, 200),
      );
    }
    return raw as PoolStock;
  }

  /**
   * Live routable PEER stock by carrier/ASN for a country (counts only — no
   * exit IPs). Powers a carrier/ASN selector: pair an entry's `asn` with
   * {@link buildProxyUrl}'s `asn` option to route to that carrier. Cached 30s.
   *
   * Runtime-validates the response envelope, same as {@link getStock}.
   *
   * @param country ISO 2-letter code, e.g. `'us'`.
   */
  async getCarrierStock(country: string): Promise<CarrierStock> {
    const raw = await this.client.request<unknown>(
      `/gateway/pool/stock/carriers?country=${encodeURIComponent(country)}`,
    );
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('carriers' in raw) ||
      !Array.isArray((raw as { carriers?: unknown }).carriers)
    ) {
      throw new ProxiesError(
        'CarrierStock response shape unexpected — possible upstream change. ' +
          'Got: ' +
          JSON.stringify(raw).slice(0, 200),
      );
    }
    return raw as CarrierStock;
  }

  /** Active incidents affecting the gateway, if any. Cached 60s. */
  getIncidents(): Promise<Incident[]> {
    return this.client.request<Incident[]>('/gateway/incidents');
  }
}

/**
 * Live gateway session management for the current user.
 *
 * Sessions are created automatically on first request through the
 * gateway. They persist in Redis for the rotation TTL (1 hour by
 * default; less for `auto5`/`auto20`/`auto60`/`hard`). Manual close is
 * only needed if you want the session's pinned IP released BEFORE the
 * TTL fires.
 *
 * Sessions created without an explicit `-sid-` token (synthesized
 * `auto_*` ids) get a 5-min TTL — they're internal-only and shouldn't
 * surface in customer dashboards. Filter via `session.isSynthesizedSid`.
 *
 * @since 0.4.0
 */
export class SessionsApi {
  constructor(private readonly client: ProxiesClient) {}

  /**
   * List active sessions.
   *
   * MULTI-TENANT: when one API key serves many customers, pass `{ pakId }` to
   * scope the result to a single customer's sessions. `pakId` is the customer's
   * Pool Access Key id (`PoolAccessKey.id`, what `getUserKeyId` returns) or its
   * `pak_` value. Without it, the API key holder's full session list is returned.
   *
   * @example
   * ```ts
   * const { sessions, count } = await client.sessions.list({ pakId });
   * for (const s of sessions) {
   *   if (s.isSynthesizedSid) continue;            // hide internal
   *   const url = s.proxyUrl.replace('<PASSWORD>', myPak);
   *   console.log(s.country, s.currentIp, '→', url);
   * }
   * ```
   *
   * @example multi-tenant reseller
   * ```ts
   * // In your customer dashboard backend
   * const { sessions } = await client.sessions.list(customer.pakKey);
   * ```
   *
   * @since 0.4.0 — `pakKey` param added 0.5.0 to close cross-customer
   *   session-list leak; passing it is strongly recommended for resellers.
   */
  list(opts?: { pakId?: string }): Promise<ActiveSessionsResponse> {
    const qs = opts?.pakId ? `?pakId=${encodeURIComponent(opts.pakId)}` : '';
    return this.client.request<ActiveSessionsResponse>(`/gateway/pool/my-sessions${qs}`);
  }

  /**
   * Close ONE session. The customer's connection drops on the next
   * gateway-side check (within ~5 s).
   *
   * Idempotent — closing an already-closed or non-existent session returns
   * `success: false` with `Session not found`. MULTI-TENANT: pass `{ pakId }`
   * so the server verifies the session belongs to that customer before closing —
   * without it, any session under the API key holder is closable.
   */
  close(sessionKey: string, opts?: { pakId?: string }): Promise<{ success: boolean; message: string }> {
    const qs = opts?.pakId ? `?pakId=${encodeURIComponent(opts.pakId)}` : '';
    return this.client.request(
      `/gateway/pool/my-sessions/${encodeURIComponent(sessionKey)}${qs}`,
      { method: 'DELETE' },
    );
  }

  /**
   * Close ALL active sessions. Use sparingly. MULTI-TENANT: pass `{ pakId }` to
   * close only that customer's sessions — WITHOUT it this closes every session
   * for the API key holder (i.e. all customers of a reseller).
   */
  closeAll(opts?: { pakId?: string }): Promise<{ success: boolean; message: string; count: number }> {
    const qs = opts?.pakId ? `?pakId=${encodeURIComponent(opts.pakId)}` : '';
    return this.client.request(`/gateway/pool/my-sessions${qs}`, { method: 'DELETE' });
  }
}

/**
 * Private modems — a whole 4G/5G modem rented per day, week or month and paid
 * from the account balance. Unlimited traffic, own HTTP and SOCKS5 host:port,
 * rotate on demand, renew and auto-renew.
 *
 * Money calls ({@link buy}, {@link buyCart}, {@link renew}) carry an
 * `Idempotency-Key` on every call: yours, or one generated per call. The same
 * key with the same body returns the same order, so the SDK's retries can
 * never charge twice. Buying needs an API key with the `modems:purchase` scope.
 *
 * When a money call ends in a {@link ProxiesTimeoutError}, a 5xx or a 409
 * `renewal_open`, the charge may or may not have happened. The key the SDK
 * sent is on the error as `err.idempotencyKey`: replay the same call with
 * `idempotencyKey: err.idempotencyKey` (same order back, no second charge) or
 * read {@link mine} and look for the order. Do not call again without it: a
 * fresh key is a fresh order, and the platform's `recent_checkout` guard only
 * covers the first 2 minutes.
 *
 * Flow: `catalog()` → show `priceUsd`, get a yes → `buy({ tariffId,
 * expectedPriceUsd })` → poll `mine()` until the modem is `active` and has
 * `credentials` (about 10-60 s).
 *
 * @since 0.10.0
 */
export class PrivateModemsApi {
  constructor(private readonly client: ProxiesClient) {}

  /** Whether private modems are offered at all (drives a sidebar entry). */
  status(): Promise<{ enabled: boolean }> {
    return this.client.request<{ enabled: boolean }>('/private-modems/status');
  }

  /** Plans in stock with the retail price per period. Read it again before every checkout. */
  catalog(): Promise<PrivateModemCatalog> {
    return this.client.request<PrivateModemCatalog>('/private-modems/catalog');
  }

  /** The caller's modems with live credentials, plus orders still settling and recent failures. */
  mine(): Promise<PrivateModemsMine> {
    return this.client.request<PrivateModemsMine>('/private-modems/mine');
  }

  /**
   * Buy one modem from the balance. `expectedPriceUsd` is the `priceUsd` the
   * user confirmed from {@link catalog}; a 409 `price_changed` means the price
   * moved — confirm the new one and call again with a NEW key.
   *
   * Pass `idempotencyKey` (e.g. your invoice id) to make app-level replays
   * safe as well; the SDK always sends one.
   *
   * @throws {ProxiesApiError} 409 `recent_checkout` when the same items were
   *   bought under 2 minutes ago — use {@link buyCart} with `confirmAgain`.
   */
  async buy(input: BuyPrivateModemInput): Promise<PrivateModemOrder> {
    if (!input.tariffId) throw new ProxiesConfigError('privateModems.buy: tariffId is required');
    requireExpectedPrice('privateModems.buy', input.expectedPriceUsd);
    const { idempotencyKey, ...body } = input;
    return this.client.request<PrivateModemOrder>('/private-modems/orders', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: idempotencyHeader('privateModems.buy', idempotencyKey),
    });
  }

  /**
   * Several modems in one checkout, debited once. `expectedPriceUsd` on each
   * item is the unit price. At most `catalog().maxCartModems` modems.
   */
  async buyCart(input: BuyPrivateModemCartInput): Promise<PrivateModemCart> {
    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new ProxiesConfigError('privateModems.buyCart: items must be a non-empty array');
    }
    for (const item of input.items) {
      if (!item.tariffId) throw new ProxiesConfigError('privateModems.buyCart: every item needs a tariffId');
      requireExpectedPrice('privateModems.buyCart', item.expectedPriceUsd);
    }
    const { idempotencyKey, ...body } = input;
    return this.client.request<PrivateModemCart>('/private-modems/orders', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: idempotencyHeader('privateModems.buyCart', idempotencyKey),
    });
  }

  /** Renewal prices for 24 h, 7 d and 30 d, each with the new end date. */
  async renewalQuote(modemId: string): Promise<PrivateModemRenewalQuote> {
    requireModemId('privateModems.renewalQuote', modemId);
    return this.client.request<PrivateModemRenewalQuote>(
      `/private-modems/${encodeURIComponent(modemId)}/renewal-quote`,
    );
  }

  /**
   * Renew from the balance. `expectedPriceUsd` is the option's `priceUsd` from
   * {@link renewalQuote}; `period` defaults to the modem's own term.
   *
   * @throws {ProxiesApiError} 409 `renewal_open` while a renewal is settling,
   *   409 `recent_renewal` within 2 minutes of a success (resend with
   *   `confirmAgain: true` if a second term really is wanted).
   */
  async renew(modemId: string, input: RenewPrivateModemInput): Promise<PrivateModemOrder> {
    requireModemId('privateModems.renew', modemId);
    requireExpectedPrice('privateModems.renew', input.expectedPriceUsd);
    const { idempotencyKey, ...body } = input;
    return this.client.request<PrivateModemOrder>(
      `/private-modems/${encodeURIComponent(modemId)}/renew`,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: idempotencyHeader('privateModems.renew', idempotencyKey),
      },
    );
  }

  /**
   * Rotate the IP now (free). The platform does not key this call, so the SDK
   * never retries it — a timeout here means "check `mine()`", not "call again".
   * A rotation or replacement already in flight answers 409 `line_busy`.
   */
  async rotate(modemId: string): Promise<PrivateModemRotateResult> {
    requireModemId('privateModems.rotate', modemId);
    return this.client.request<PrivateModemRotateResult>(
      `/private-modems/${encodeURIComponent(modemId)}/rotate`,
      { method: 'POST' },
    );
  }

  /**
   * Renew automatically from the balance before the term ends (opt-in).
   * `period` defaults to the modem's own term. Tell the user it charges the
   * balance on its own; `PrivateModem.autoRenewIssue` says when it could not.
   */
  async setAutoRenew(
    modemId: string,
    input: { enabled: boolean; period?: PrivateModemPeriod },
  ): Promise<PrivateModemAutoRenew> {
    requireModemId('privateModems.setAutoRenew', modemId);
    return this.client.request<PrivateModemAutoRenew>(
      `/private-modems/${encodeURIComponent(modemId)}/auto-renew`,
      { method: 'PUT', body: JSON.stringify(input) },
    );
  }

  /**
   * Swap to another modem in the same country, keeping the paid time. The
   * login details change: read `mine()` afterwards. Not keyed by the platform,
   * so never retried by the SDK (3 calls per minute).
   */
  async replace(modemId: string): Promise<{ replaced: true }> {
    requireModemId('privateModems.replace', modemId);
    return this.client.request<{ replaced: true }>(
      `/private-modems/${encodeURIComponent(modemId)}/replace`,
      { method: 'POST' },
    );
  }
}

// ────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * A request may be re-sent only when re-sending cannot repeat a side effect:
 * reads always, writes only under an `Idempotency-Key` (the platform then
 * replays the first response instead of acting twice).
 */
function isRetrySafe(init: RequestInit, idempotencyKey: string | undefined): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  return !!idempotencyKey;
}

/** The `Idempotency-Key` value in `headers`, whatever shape `HeadersInit` took. */
function idempotencyKeyOf(headers: HeadersInit | undefined): string | undefined {
  if (!headers) return undefined;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return headers.get('Idempotency-Key') ?? undefined;
  }
  const entries = Array.isArray(headers) ? headers : Object.entries(headers);
  const match = entries.find(([name, value]) => name.toLowerCase() === 'idempotency-key' && !!value);
  return match?.[1];
}

/**
 * The `Idempotency-Key` header for a money or minting call: the caller's key,
 * or one generated once for this call (before the retry loop, never inside
 * it). Validated the way the platform does so a bad key fails here, not as a
 * 400 after the fact.
 */
function idempotencyHeader(method: string, key: string | undefined): Record<string, string> {
  const value = key ?? newIdempotencyKey();
  if (!IDEMPOTENCY_KEY_RE.test(value)) {
    throw new ProxiesConfigError(
      `${method}: idempotencyKey must be 8-128 characters of letters, digits, '_' or '-'`,
    );
  }
  return { 'Idempotency-Key': value };
}

function newIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === 'function') return webCrypto.randomUUID();
  // Node 18 has no global crypto; uniqueness is all an idempotency key needs.
  return `sdk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

function requireModemId(method: string, modemId: string): void {
  if (!modemId) throw new ProxiesConfigError(`${method}: modemId is required`);
}

/** The platform refuses a charge without the price the user saw; fail before the network does. */
function requireExpectedPrice(method: string, expectedPriceUsd: number | undefined): void {
  if (typeof expectedPriceUsd !== 'number' || !Number.isFinite(expectedPriceUsd)) {
    throw new ProxiesConfigError(`${method}: expectedPriceUsd (the price shown to the user) is required`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse an HTTP `Retry-After` header into milliseconds.
 * Per RFC 7231, the value is either delta-seconds OR an HTTP-date.
 */
function parseRetryAfter(header: string): number {
  const trimmed = header.trim();
  // Delta-seconds: integer.
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  // HTTP-date.
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return 0;
}

/** Version string, injected at build time by tsup from package.json. */
declare const __SDK_VERSION__: string;
const VERSION: string =
  typeof __SDK_VERSION__ !== 'undefined' ? __SDK_VERSION__ : '0.0.0-dev';
