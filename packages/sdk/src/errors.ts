/**
 * Base class for all errors thrown by the SDK. Extend this for type-narrowing
 * in host apps: `if (err instanceof ProxiesError) { ... }`.
 */
export class ProxiesError extends Error {
  /**
   * The `Idempotency-Key` the failed request carried, when it carried one
   * (`poolKeys.create/update/topUp/regenerate`, `privateModems.buy/buyCart/renew`).
   * After a {@link ProxiesTimeoutError} or an ambiguous 409 the outcome is
   * unknown: replay the same call with `idempotencyKey: err.idempotencyKey`
   * (the platform returns the first result instead of acting twice) or read
   * the resource back; never call again without it.
   *
   * @since 0.10.0
   */
  public idempotencyKey?: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Preserve prototype chain across compilation targets
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * HTTP error from the Proxies.sx API. Inspect `status` to distinguish auth
 * failures (401/403) from rate limits (429) from upstream problems (5xx).
 *
 * For support correlation, log `err.requestId` — the platform uses the
 * same value to scan logs and trace your request server-side.
 */
export class ProxiesApiError extends ProxiesError {
  /**
   * Server-side request identifier from the `X-Request-ID` response header,
   * or `undefined` if the response didn't carry one (older API versions
   * or network errors that never reached the server).
   *
   * Paste this into a Proxies.sx support ticket to skip the back-and-forth:
   * @example
   * ```ts
   * try {
   *   await client.poolKeys.create({ label: 'alice' });
   * } catch (err) {
   *   if (err instanceof ProxiesApiError) {
   *     logger.error({ err, status: err.status, requestId: err.requestId });
   *   }
   *   throw err;
   * }
   * ```
   *
   * @since 0.3.0
   */
  public readonly requestId: string | undefined;

  constructor(
    public readonly status: number,
    public readonly body: string,
    /** Parsed body if JSON, otherwise undefined. */
    public readonly data?: unknown,
    requestId?: string,
  ) {
    super(`Proxies.sx API error ${status}: ${truncate(body, 200)}`);
    this.requestId = requestId;
  }

  /** Convenience: true for 401/403. */
  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  /** Convenience: true for 429. */
  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Convenience: true for 5xx. */
  get isServer(): boolean {
    return this.status >= 500;
  }

  /**
   * `true` if this error class is the kind the SDK's internal retry would
   * fire on. Useful if you've disabled SDK retries (`retry: false`) and
   * are wrapping your own.
   *
   * @since 0.3.0
   */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** Thrown when the request times out client-side before the server responds. */
export class ProxiesTimeoutError extends ProxiesError {
  constructor(public readonly timeoutMs: number) {
    super(`Proxies.sx API request timed out after ${timeoutMs}ms`);
  }
}

/** Thrown when the SDK is mis-configured (e.g. missing apiKey). */
export class ProxiesConfigError extends ProxiesError {}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
