import type {
  ClientConfig,
  CreatePoolAccessKeyInput,
  UpdatePoolAccessKeyInput,
  TopUpPoolAccessKeyInput,
  PoolAccessKey,
  PoolKeyOperation,
  PoolAccessKeyAuditEvent,
  AuditQueryOpts,
  PakUsageSeries,
  PakUsageSummary,
  PoolStock,
  CarrierStock,
  CarrierStockAll,
  CarrierStockPool,
  PoolCities,
  PoolFacets,
  Incident,
  IncidentsResponse,
  BuildProxyUrlOpts,
  RetryConfig,
  ActiveSession,
  ActiveSessionsResponse,
  SessionBindingObservation,
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
 * const url = proxies.buildProxyUrl(key.key, { pool: 'peer', country: 'us', rotation: 'sticky' });
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
  }

  /**
   * Build a customer-facing proxy URL. Sugar over the standalone
   * {@link buildProxyUrl} helper, using the `proxyUsername` and `gatewayHost`
   * from this client's config.
   *
   * Explicitly choose `opts.pool`; omission defaults to the mobile `mbl` pool.
   * Choose `peer` plus `ipType: 'residential'` for residential-only routing.
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

  /** @internal Low-level request used by the sub-APIs. Not stable API. */
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? 'GET').toUpperCase();
    const sharedPoolMutation =
      method !== 'GET' && method !== 'HEAD' &&
      (/^\/reseller\/pool-keys(?:[/?]|$)/.test(path) ||
        /^\/gateway\/pool\/my-sessions(?:[/?]|$)/.test(path));
    // A replay token does not close the provider's concurrent/crash window.
    // An ambiguous write needs host-owned recovery, not automatic redispatch.
    const attempts = sharedPoolMutation ? 1 : (this.retry?.attempts ?? 1);
    let lastErr: unknown;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.requestOnce<T>(path, init);
      } catch (err) {
        lastErr = err;
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
   * Pass `idempotencyKey` (UUIDv4 or a deterministic ID tied to a domain
   * object like a `payment_intent_id`). The durable lifecycle contract admits
   * immutable intent once and exposes operation inspection after response loss.
   * Persist intent before dispatch; use operationByToken() for reconciliation.
   * The SDK does not automatically retry shared-pool mutations. Pre-cutover
   * cached operations require review; missing old evidence does not allow replay.
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
    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined) {
      if (!input.idempotencyKey) {
        throw new ProxiesConfigError('poolKeys.create: idempotencyKey, if set, must be non-empty');
      }
      headers['Idempotency-Key'] = input.idempotencyKey;
    }
    // Strip idempotencyKey from the body (it's a header, not a field).
    const { idempotencyKey: _omit, ...body } = input;
    return this.client.request<PoolAccessKey>('/reseller/pool-keys', {
      method: 'POST',
      body: JSON.stringify(body),
      headers,
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

  /** Inspect an operation without redispatching its effect. */
  operation(operationId: string): Promise<PoolKeyOperation> {
    if (!operationId) throw new ProxiesConfigError('poolKeys.operation: operationId is required');
    return this.client.request(`/reseller/pool-keys/operations/${encodeURIComponent(operationId)}`);
  }

  /** Recover a lost response using the token persisted before the original write. */
  operationByToken(idempotencyKey: string): Promise<PoolKeyOperation> {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new ProxiesConfigError('poolKeys.operationByToken: invalid operation key');
    return this.client.request('/reseller/pool-keys/operations/lookup', { headers: { 'Idempotency-Key': idempotencyKey } });
  }

  /** Resume only a current quota-only hold after an authorized entitlement reconciliation. */
  resume(keyId: string, input: { expectedLifecycleVersion: number; idempotencyKey: string }): Promise<PoolAccessKey> {
    if (!keyId || !Number.isSafeInteger(input.expectedLifecycleVersion) || input.expectedLifecycleVersion < 0) {
      throw new ProxiesConfigError('poolKeys.resume: keyId and a valid lifecycle version are required');
    }
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new ProxiesConfigError('poolKeys.resume: invalid operation key');
    return this.client.request(`/reseller/pool-keys/${encodeURIComponent(keyId)}/resume`, {
      method: 'POST', headers: { 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({ expectedLifecycleVersion: input.expectedLifecycleVersion }),
    });
  }

  /**
   * Update a key. Any field left undefined is untouched.
   *
   * @remarks Setting `enabled: false` changes the stored key. Gateway caches
   *   and existing tunnels may outlive that change; no immediate cutoff is promised.
   *
   *   For top-ups (extending an existing credit), prefer {@link topUp}
   *   over `update` for its cap increment. The lifecycle contract serializes
   *   key mutations; a busy or uncertain key requires reconciliation. Top-up
   *   does not clear holds or resume the key. Use conditional resume after review.
   */
  async update(keyId: string, input: UpdatePoolAccessKeyInput, opts?: { idempotencyKey?: string }): Promise<PoolAccessKey> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.update: keyId is required');
    return this.client.request<PoolAccessKey>(`/reseller/pool-keys/${encodeURIComponent(keyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
      headers: operationHeaders(opts?.idempotencyKey),
    });
  }

  /**
   * Top up a key with additional GB and/or extended expiry.
   *
   * - `addTrafficGB` is added to the current cap server-side via a single
   *   `$inc`. If the existing cap is `null` (unbounded), it stays `null`.
   * - `extendDays` computes from `max(now, observed_expiresAt)` — if no
   *   expiry was observed, from `now`, inside the key's admitted operation.
   *
   * Persist `idempotencyKey` (e.g. your invoice id) before dispatch. Inspect
   * ambiguous outcomes with operationByToken(); do not repeat the write under
   * a fresh token. Existing quota use and independent holds are preserved.
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
    const headers: Record<string, string> = {};
    if (input.idempotencyKey !== undefined) {
      if (!input.idempotencyKey) {
        throw new ProxiesConfigError('poolKeys.topUp: idempotencyKey, if set, must be non-empty');
      }
      headers['Idempotency-Key'] = input.idempotencyKey;
    }
    const { idempotencyKey: _omit, ...body } = input;
    return this.client.request<PoolAccessKey>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}/topup`,
      { method: 'POST', body: JSON.stringify(body), headers },
    );
  }

  /**
   * Rotate the secret value of a key. Use this if the old value was leaked.
   * The stored secret changes; gateway caches and existing tunnels may lag.
   *
   * Persist `idempotencyKey` before dispatch. Inspect the historical operation
   * separately from the CURRENT secret returned by {@link get}. Do not perform
   * another regeneration to recover a lost response. A current credential
   * observation does not fence another authorized writer or revoke open sockets.
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
    const headers: Record<string, string> = {};
    if (opts.idempotencyKey !== undefined) {
      if (!opts.idempotencyKey) {
        throw new ProxiesConfigError('poolKeys.regenerate: idempotencyKey, if set, must be non-empty');
      }
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }
    return this.client.request<PoolAccessKey>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}/regenerate`,
      { method: 'POST', headers },
    );
  }

  /** Permanently delete a key. Cannot be undone. */
  async delete(keyId: string, opts?: { idempotencyKey?: string }): Promise<void> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.delete: keyId is required');
    await this.client.request<{ message: string }>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}`,
      { method: 'DELETE', headers: operationHeaders(opts?.idempotencyKey) },
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

  /**
   * Per-customer bandwidth time-series for ONE key: daily in/out MB buckets
   * over the last `days` days (default 30, max 365), gap-filled with zeroes.
   * Ownership-scoped — 404 if the key is not yours — so a customer dashboard
   * can call it with that customer's own `keyId` and chart exactly their
   * usage, never the reseller-wide total. Needs `customers:read`.
   *
   * @example
   * ```ts
   * const { series, totalGB } = await proxies.poolKeys.usage(keyId, { days: 30 });
   * // series: [{ date: '2026-10-05', mbIn: 120.5, mbOut: 8.1, mb: 128.6 }, …]
   * ```
   *
   * @since 0.14.0
   */
  async usage(keyId: string, opts: { days?: number } = {}): Promise<PakUsageSeries> {
    if (!keyId) throw new ProxiesConfigError('poolKeys.usage: keyId is required');
    const qs = usageWindowQuery(opts.days, 'poolKeys.usage');
    return this.client.request<PakUsageSeries>(
      `/reseller/pool-keys/${encodeURIComponent(keyId)}/usage${qs}`,
    );
  }

  /**
   * Reseller-wide pool-key bandwidth: a daily GB series across ALL of your
   * keys plus a per-key breakdown, from the same 90-day rollup that feeds
   * {@link usage}. This is the number to reconcile your own billing against.
   * Needs the `traffic:read` scope (it lives under `/reseller/analytics`).
   *
   * @example
   * ```ts
   * const month = await proxies.poolKeys.usageSummary({ days: 30 });
   * console.log(month.totalGB, 'GB across', month.activeKeys, 'keys');
   * for (const k of month.byKey) console.log(k.label, k.gb);
   * ```
   *
   * @since 0.14.0
   */
  usageSummary(opts: { days?: number } = {}): Promise<PakUsageSummary> {
    const qs = usageWindowQuery(opts.days, 'poolKeys.usageSummary');
    return this.client.request<PakUsageSummary>(`/reseller/analytics/pak-usage${qs}`);
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
   * Live routable stock by carrier/ASN (counts only — never exit IPs). Powers a
   * carrier/ASN selector: pair an entry's `asn` with {@link buildProxyUrl}'s
   * `asn` option to route to that carrier, or filter on `ipType` to offer
   * mobile-vs-residential. Cached 30s server-side.
   *
   * Scope it two ways, independently:
   * - **country** — omit it to get the FULL catalogue, every country in one
   *   call. Pass one to get just that country.
   * - **pool** — `peer` (default) is the mixed residential+mobile fleet; `mbl`
   *   is the carrier-modem tier (every entry `ipType: 'mobile'`, 6 countries);
   *   `all` merges both.
   *
   * Runtime-validates the response envelope, same as {@link getStock}.
   *
   * @example Full catalogue, every country, both pools
   * ```ts
   * const all = await client.pool.getCarrierStock({ pool: 'peer' }); // peer, all countries
   * const mob = await client.pool.getCarrierStock({ pool: 'mbl' });
   * const us  = await client.pool.getCarrierStock({ country: 'us', pool: 'all' });
   * ```
   */
  async getCarrierStock(opts: { country: string; pool?: CarrierStockPool }): Promise<CarrierStock>;
  async getCarrierStock(opts?: { pool?: CarrierStockPool }): Promise<CarrierStockAll>;
  /** @deprecated Pass `{ country }` instead — kept so existing calls keep working. */
  async getCarrierStock(country: string): Promise<CarrierStock>;
  async getCarrierStock(
    arg?: string | { country?: string; pool?: CarrierStockPool },
  ): Promise<CarrierStock | CarrierStockAll> {
    const { country, pool } = typeof arg === 'string' ? { country: arg, pool: undefined } : (arg ?? {});
    const qs = new URLSearchParams();
    if (country) qs.set('country', country);
    if (pool) qs.set('pool', pool);
    const q = qs.toString();
    const raw = await this.client.request<unknown>(
      `/gateway/pool/stock/carriers${q ? `?${q}` : ''}`,
    );
    // The two scopes return different envelopes: one country -> `carriers[]`,
    // all countries -> `countries{}`. Validate whichever we asked for, so a
    // silent upstream shape change still surfaces instead of returning junk.
    const ok = country
      ? !!raw && typeof raw === 'object' && Array.isArray((raw as { carriers?: unknown }).carriers)
      : !!raw && typeof raw === 'object' && !!(raw as { countries?: unknown }).countries;
    if (!ok) {
      throw new ProxiesError(
        'CarrierStock response shape unexpected — possible upstream change. ' +
          'Got: ' +
          JSON.stringify(raw).slice(0, 200),
      );
    }
    return raw as CarrierStock | CarrierStockAll;
  }

  /**
   * Live routable stock by city and region for ONE country (counts only — never
   * exit IPs). Powers a city / state picker: pair a `cities[].city` with
   * {@link buildProxyUrl}'s `city`, or a `regions[].region` with its `state`.
   * Both are **hard** peer-only filters at the gateway (no match → 502), so
   * only offer a city or region that this call reports stock for. Cached 30s.
   *
   * Peer-only by design: carrier modems (`mbl`) drift across cities on carrier
   * NAT, so city/region data is meaningful only for the residential/peer fleet.
   * `pool` defaults to `peer`; `mbl` / `all` are accepted but usually sparse.
   *
   * Runtime-validates the envelope, same as {@link getStock}.
   *
   * @example
   * ```ts
   * const { cities, regions } = await client.pool.getCities('us', { pool: 'peer' });
   * // cities:  [{ city: 'brooklyn', label: 'Brooklyn', count: 6 }, …]
   * // regions: [{ region: 'ca', count: 43 }, { region: 'fl', count: 35 }, …]
   * const url = buildProxyUrl(me, pak, { country: 'us', pool: 'peer', city: 'brooklyn' });
   * ```
   */
  async getCities(country: string, opts?: { pool?: CarrierStockPool }): Promise<PoolCities> {
    if (!country) {
      throw new ProxiesError('getCities: country is required (2-letter ISO code, e.g. "us")');
    }
    const qs = new URLSearchParams({ country });
    if (opts?.pool) qs.set('pool', opts.pool);
    const raw = await this.client.request<unknown>(`/gateway/pool/stock/cities?${qs.toString()}`);
    if (
      !raw ||
      typeof raw !== 'object' ||
      !Array.isArray((raw as { cities?: unknown }).cities) ||
      !Array.isArray((raw as { regions?: unknown }).regions)
    ) {
      throw new ProxiesError(
        'PoolCities response shape unexpected — possible upstream change. ' +
          'Got: ' +
          JSON.stringify(raw).slice(0, 200),
      );
    }
    return raw as PoolCities;
  }

  /**
   * Cross-filtered city + carrier + region facets for one country — the pickers
   * narrow each other. Pass the OTHER pickers' current selection so each list
   * reflects what is actually co-available: `city` narrows the carrier list to
   * carriers present in that city, `carrier` narrows the city list to cities
   * that carrier serves, `state` narrows both to that region. This is what
   * makes a "city smallens carrier and vice versa" UI match the backend exactly,
   * rather than each dropdown showing counts that ignore the others. Counts
   * only; peer-pool by default; cached 15s.
   *
   * Runtime-validates the envelope, same as {@link getStock}.
   *
   * @example Progressive narrowing
   * ```ts
   * const all = await client.pool.getFacets({ pool: 'peer', country: 'us' });
   * // all.cities, all.states, all.carriers each reflect the whole country
   * const inCA = await client.pool.getFacets({ pool: 'peer', country: 'us', state: 'ca' });
   * // inCA.cities + inCA.carriers now only what co-exists in California
   * const onComcast = await client.pool.getFacets({ pool: 'peer', country: 'us', carrier: '7922' });
   * // onComcast.cities now only cities where Comcast (ASN 7922) has stock
   * ```
   */
  async getFacets(opts: {
    country: string;
    pool?: CarrierStockPool;
    city?: string;
    carrier?: string;
    state?: string;
  }): Promise<PoolFacets> {
    if (!opts?.country) {
      throw new ProxiesError('getFacets: country is required (2-letter ISO code, e.g. "us")');
    }
    const qs = new URLSearchParams({ country: opts.country });
    if (opts.pool) qs.set('pool', opts.pool);
    if (opts.city) qs.set('city', opts.city);
    if (opts.carrier) qs.set('carrier', opts.carrier);
    if (opts.state) qs.set('state', opts.state);
    const raw = await this.client.request<unknown>(`/gateway/pool/stock/facets?${qs.toString()}`);
    if (
      !raw ||
      typeof raw !== 'object' ||
      !Array.isArray((raw as { cities?: unknown }).cities) ||
      !Array.isArray((raw as { carriers?: unknown }).carriers) ||
      !Array.isArray((raw as { states?: unknown }).states)
    ) {
      throw new ProxiesError(
        'PoolFacets response shape unexpected — possible upstream change. ' +
          'Got: ' +
          JSON.stringify(raw).slice(0, 200),
      );
    }
    return raw as PoolFacets;
  }

  /**
   * Active incidents affecting the gateway, if any. Cached 60s. Each entry
   * carries a ready-to-render `message`; an empty array means all nominal.
   *
   * The live endpoint returns `{ incidents, generatedAt, stale }` — this
   * method unwraps the envelope so you always get a plain `Incident[]`.
   */
  async getIncidents(): Promise<Incident[]> {
    const res = await this.client.request<IncidentsResponse>('/gateway/incidents');
    return res.incidents ?? [];
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
   * Pool Access Key record id (`PoolAccessKey.id`, what `getUserKeyId` returns).
   * Without it, the API key holder's full session list is returned.
   *
   * @example
   * ```ts
   * const { sessions, count } = await client.sessions.list({ pakId });
   * for (const s of sessions) {
   *   if (s.isSynthesizedSid) continue;            // hide internal
   *   const url = s.proxyUrl.replace('<PASSWORD>', myPak);
   *   console.log(s.country, s.carrier, '→', url);
   * }
   * ```
   *
   * @example multi-tenant reseller
   * ```ts
   * // In your customer dashboard backend
   * const { sessions, truncated } = await client.sessions.list({ pakId: customer.providerKeyId });
   * ```
   *
   * @since 0.4.0 — `pakKey` param added 0.5.0 to close cross-customer
   *   session-list leak; passing it is strongly recommended for resellers.
   */
  list(opts?: { pakId?: string }): Promise<ActiveSessionsResponse> {
    const qs = opts?.pakId ? `?pakId=${encodeURIComponent(opts.pakId)}` : '';
    return this.client.request<ActiveSessionsResponse>(`/gateway/pool/my-sessions${qs}`);
  }

  /** Read one binding without widening the caller's PAK scope. Requires binding contract v2. */
  get(sessionKey: string, opts: { pakId: string }): Promise<SessionBindingObservation> {
    if (!sessionKey || !opts?.pakId) throw new ProxiesConfigError('sessions.get: sessionKey and pakId are required');
    return this.client.request(`/gateway/pool/my-sessions/${encodeURIComponent(sessionKey)}?pakId=${encodeURIComponent(opts.pakId)}`);
  }

  /**
   * Release ONE binding. Existing sockets continue; an exported URL may rebind.
   * Always check `success`. A timeout is an unknown outcome, not safe to replay
   * against a potentially newer binding. Pass its observed `generation` for a
   * conditional release on gateway versions supporting that contract.
   * MULTI-TENANT: pass `{ pakId }`
   * so the server verifies the session belongs to that customer before closing —
   * without it, any session under the API key holder is closable.
   */
  close(sessionKey: string, opts?: { pakId?: string; generation?: string }): Promise<{ success: boolean; message: string }> {
    const query = new URLSearchParams();
    if (opts?.pakId) query.set('pakId', opts.pakId);
    if (opts?.generation) query.set('generation', opts.generation);
    const qs = query.size ? `?${query}` : '';
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

// ────────────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function operationHeaders(idempotencyKey?: string): Record<string, string> {
  if (idempotencyKey === undefined) return {};
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new ProxiesConfigError('Invalid operation key');
  return { 'Idempotency-Key': idempotencyKey };
}

/** `?days=N` for the two usage endpoints, or '' when unset. Rejects a non-positive window. */
function usageWindowQuery(days: number | undefined, method: string): string {
  if (days === undefined) return '';
  if (!Number.isFinite(days) || days <= 0) {
    throw new ProxiesConfigError(`${method}: days must be a positive number (server clamps to 1..365)`);
  }
  return `?days=${Math.floor(days)}`;
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
