'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MeResponse, Pool, PoolStock, CarrierStock, Incident } from './types';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface HookResult<T> extends FetchState<T> {
  /** Re-run the fetch. Returns the new data (or throws). */
  refetch: () => Promise<T>;
}

/** Shared fetcher that respects abort signals and normalizes errors. */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${url} → ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }
  return (await res.json()) as T;
}

/**
 * Write counterpart to {@link getJson}.
 *
 * Lease mutations fail for reasons the customer can act on — "no free device in
 * US right now", "wait 7s before rotating again", "you're holding your 500
 * reserved IPs". The platform puts that sentence in `message`, and
 * `createPoolApiHandlers` forwards it, so surface THAT rather than a bare
 * "HTTP 409" the customer can do nothing with.
 */
async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON body (proxy error page, HTML 502) — fall through to the status message.
    }
  }

  if (!res.ok) {
    throw new Error(messageOf(data) ?? `${method} ${url} → ${res.status}`);
  }
  return data as T;
}

/** Pull the human-readable reason out of a platform/handler error body. */
function messageOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const body = data as { message?: unknown; error?: unknown };
  if (typeof body.message === 'string' && body.message) return body.message;
  if (typeof body.error === 'string' && body.error) return body.error;
  return null;
}

/**
 * Fetches the authenticated user's pool access key + usage snapshot from the
 * host app's API route.
 *
 * @param apiRoute Base path mounted on the host, typically `/api/pool`.
 *                 Hook calls `${apiRoute}/me`.
 * @param options  Optional refresh interval in ms. Default: none (fetch once).
 */
export function usePoolKey(
  apiRoute: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<MeResponse> {
  return usePolling<MeResponse>(`${apiRoute}/me`, options.refreshIntervalMs);
}

/**
 * Fetches live pool stock from the host's API route (which proxies to
 * `/v1/gateway/pool/stock`).
 *
 * @param apiRoute Base path, e.g. `/api/pool`.
 * @param options  Refresh interval — useful for the pool indicator pulse.
 *                 Default 30 000 ms (matches server-side cache TTL).
 */
export function usePoolStock(
  apiRoute: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<PoolStock> {
  return usePolling<PoolStock>(`${apiRoute}/stock`, options.refreshIntervalMs ?? 30_000);
}

/**
 * Fetches live routable PEER stock by carrier/ASN for a country (counts only).
 * Re-fetches when `country` changes. Proxies to
 * `/v1/gateway/pool/stock/carriers`. Drives a carrier/ASN selector — pair an
 * entry's `asn` with `buildProxyString({ asn })`.
 *
 * @param apiRoute Base path, e.g. `/api/pool`.
 * @param country  ISO 2-letter code, e.g. `'us'`.
 */
export function usePoolCarrierStock(
  apiRoute: string,
  country: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<CarrierStock> {
  return usePolling<CarrierStock>(
    `${apiRoute}/stock/carriers?country=${encodeURIComponent(country)}`,
    options.refreshIntervalMs ?? 30_000,
  );
}

/** Fetches active gateway incidents. Poll every 60s by default. */
export function useIncidents(
  apiRoute: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<Incident[]> {
  return usePolling<Incident[]>(`${apiRoute}/incidents`, options.refreshIntervalMs ?? 60_000);
}

/* ── Reserved IPs (Private Pool leases) ───────────────────────────────── */

/**
 * Rotation cadence that lives ON one reserved IP. `off` is the explicit "hold
 * this device" choice and the default — not the absence of a choice. The
 * `auto*` modes swap the held device on that cadence, but only while the lease
 * is carrying traffic; an idle hold is never rotated.
 *
 * @since 0.12.0
 */
export type LeaseRotationMode = 'off' | 'auto5' | 'auto10' | 'auto20' | 'auto60';

/**
 * Failover scope stored on a lease — where the gateway may re-pick when the
 * held device is offline. Only `strict` refuses to substitute.
 *
 * @since 0.12.0
 */
export type LeaseFailover = 'any' | 'samecountry' | 'samecarrier' | 'samenode' | 'strict';

/**
 * One exclusively-held device ("reserved IP") inside a Private Pool.
 *
 * @since 0.12.0
 */
export interface PoolLease {
  /** Stable id — this is what `-pin-lease-<id>` names in the proxy username. */
  leaseId: string;
  /** Upper-case ISO-2 country of the held device. */
  country: string;
  /** Verified access class of the held device. */
  ipType: 'mobile' | 'residential' | 'datacenter' | (string & {});
  /** Resolved carrier/ISP display name, or `null` when the ASN is unnamed. */
  carrier: string | null;
  /**
   * The held exit IP, masked to a /16 by the platform (e.g. `85.12.x.x`). Full
   * exit IPs are never returned by any endpoint — an enumerable exit IP is an
   * IP-reputation liability for every customer on that device.
   */
  ipMasked: string | null;
  /** Failover scope this lease was reserved with. Validated against the union platform-side. */
  failover: LeaseFailover;
  /** Idle window in seconds — the hold is released after this long with no traffic. */
  idleTtlSec: number;
  /** How many times this lease has been rotated onto a different device. */
  rotateCount: number;
  rotationMode: LeaseRotationMode;
  /** Secret token of the public rotation link, or `null` when none is issued. */
  rotationToken: string | null;
  /** Full unauthenticated rotation URL, or `null`. Treat as a credential. */
  rotateUrl: string | null;
  lastRotatedAt: string | null;
  /** `true` only when the device is online AND still held by this lease. */
  deviceOnline: boolean;
  /** Last time the platform saw traffic on this lease (drives the idle reaper). */
  lastSeenActiveAt: string | null;
}

/**
 * The building blocks needed to construct a lease's proxy username.
 *
 * `proxyUsername` is NOT the reseller's own `psx_` username: a Private Pool's
 * `pak_` is minted under the platform's house reseller, and gateway auth checks
 * that the username resolves to the pak's owner. The handler reads both values
 * from the platform so the browser never has to guess them.
 *
 * @since 0.12.0
 */
export interface LeaseGateway {
  proxyUsername: string;
  /** Pool token the pool routes under — `mbl` (modem-only), `peer`, or `best`. */
  poolToken: Pool;
  /** Gateway hostname, e.g. `gw.proxies.sx`. */
  host: string;
  /** Countries this pool may reserve in (upper-case ISO-2). */
  countries: string[];
}

/**
 * Response of `GET <apiRoute>/leases`.
 *
 * @since 0.12.0
 */
export interface PoolLeaseList {
  /** `false` while the platform's Reserved-IP flag is off — reserving will 503. */
  enabled: boolean;
  /** Pool-wide ceiling on concurrent holds. */
  maxLeases: number;
  /** Holds across the WHOLE pool (all customers) — what `maxLeases` counts. */
  poolHeld: number;
  /** Holds belonging to the signed-in customer. */
  held: number;
  leases: PoolLease[];
  /** `null` when the pool has no live connection yet (unpaid / pak deleted). */
  gateway: LeaseGateway | null;
}

/**
 * Body of `POST <apiRoute>/leases`.
 *
 * @since 0.12.0
 */
export interface AcquireLeaseInput {
  /** ISO-2 country, e.g. `'us'`. */
  country: string;
  /** Soft carrier-name match, e.g. `'T-Mobile'`. Omit for any carrier. */
  carrier?: string;
  /** Hard access-class filter. Omit for any class. */
  ipType?: 'mobile' | 'residential';
  /** Idle window in seconds. Platform clamps to [600, 43200]. Default 900. */
  idleTtlSec?: number;
  /** Failover scope. Defaults to the pool's own default (usually `samecountry`). */
  failover?: LeaseFailover;
}

/** Result of issuing (or regenerating) a lease's public rotation link. */
export interface LeaseRotationLink {
  leaseId: string;
  rotationToken: string | null;
  rotateUrl: string | null;
}

/**
 * Polls the signed-in customer's reserved IPs from
 * `GET <apiRoute>/leases`. Default 15 s — matches the platform's own dashboard,
 * which is fast enough to see a rotation land without hammering the API.
 *
 * Requires `privatePool` to be configured on `createPoolApiHandlers()`;
 * without it the route 404s and this hook surfaces the error.
 *
 * @since 0.12.0
 */
export function usePoolLeases(
  apiRoute: string,
  options: { refreshIntervalMs?: number } = {},
): HookResult<PoolLeaseList> {
  return usePolling<PoolLeaseList>(`${apiRoute}/leases`, options.refreshIntervalMs ?? 15_000);
}

/**
 * Mutations for reserved IPs. Every call targets the handler mounted at
 * `apiRoute`, which re-checks ownership server-side — a leaseId the customer
 * doesn't own comes back as a plain 404.
 *
 * None of these refetch for you: pair with {@link usePoolLeases} and call its
 * `refetch()` after an action resolves, so the list and the mutation share one
 * source of truth.
 *
 * @since 0.12.0
 */
export interface LeaseActions {
  /** leaseId currently being mutated, or `null`. Use to disable that row. */
  busyLeaseId: string | null;
  /** `true` while a reserve is in flight. */
  acquiring: boolean;
  /** Last error, kept so the UI can render it after the promise settles. */
  error: Error | null;
  acquire: (input: AcquireLeaseInput) => Promise<PoolLease>;
  rotate: (leaseId: string) => Promise<void>;
  extend: (leaseId: string, idleTtlSec: number) => Promise<void>;
  release: (leaseId: string) => Promise<void>;
  setRotationMode: (leaseId: string, mode: LeaseRotationMode) => Promise<void>;
  issueRotationLink: (leaseId: string) => Promise<LeaseRotationLink>;
  revokeRotationLink: (leaseId: string) => Promise<void>;
}

/** @since 0.12.0 */
export function useLeaseActions(apiRoute: string): LeaseActions {
  const [busyLeaseId, setBusyLeaseId] = useState<string | null>(null);
  const [acquiring, setAcquiring] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Every mutation shares this wrapper so busy/error state can never drift
  // between actions — and so a throw still clears the spinner.
  const run = useCallback(
    async <T,>(leaseId: string | null, fn: () => Promise<T>): Promise<T> => {
      if (leaseId === null) setAcquiring(true);
      else setBusyLeaseId(leaseId);
      setError(null);
      try {
        return await fn();
      } catch (err) {
        setError(err as Error);
        throw err;
      } finally {
        if (leaseId === null) setAcquiring(false);
        else setBusyLeaseId((prev) => (prev === leaseId ? null : prev));
      }
    },
    [],
  );

  const leaseUrl = useCallback(
    (leaseId: string, suffix = ''): string =>
      `${apiRoute}/leases/${encodeURIComponent(leaseId)}${suffix}`,
    [apiRoute],
  );

  const acquire = useCallback(
    (input: AcquireLeaseInput): Promise<PoolLease> =>
      run(null, () => sendJson<PoolLease>(`${apiRoute}/leases`, 'POST', input)),
    [apiRoute, run],
  );

  const rotate = useCallback(
    (leaseId: string): Promise<void> =>
      run(leaseId, async () => {
        await sendJson<unknown>(leaseUrl(leaseId, '/rotate'), 'POST');
      }),
    [leaseUrl, run],
  );

  const extend = useCallback(
    (leaseId: string, idleTtlSec: number): Promise<void> =>
      run(leaseId, async () => {
        await sendJson<unknown>(leaseUrl(leaseId, '/extend'), 'POST', { idleTtlSec });
      }),
    [leaseUrl, run],
  );

  const release = useCallback(
    (leaseId: string): Promise<void> =>
      run(leaseId, async () => {
        await sendJson<unknown>(leaseUrl(leaseId), 'DELETE');
      }),
    [leaseUrl, run],
  );

  const setRotationMode = useCallback(
    (leaseId: string, mode: LeaseRotationMode): Promise<void> =>
      run(leaseId, async () => {
        await sendJson<unknown>(leaseUrl(leaseId, '/rotation-mode'), 'POST', { mode });
      }),
    [leaseUrl, run],
  );

  const issueRotationLink = useCallback(
    (leaseId: string): Promise<LeaseRotationLink> =>
      run(leaseId, () => sendJson<LeaseRotationLink>(leaseUrl(leaseId, '/rotation-token'), 'POST')),
    [leaseUrl, run],
  );

  const revokeRotationLink = useCallback(
    (leaseId: string): Promise<void> =>
      run(leaseId, async () => {
        await sendJson<unknown>(leaseUrl(leaseId, '/rotation-token'), 'DELETE');
      }),
    [leaseUrl, run],
  );

  return {
    busyLeaseId,
    acquiring,
    error,
    acquire,
    rotate,
    extend,
    release,
    setRotationMode,
    issueRotationLink,
    revokeRotationLink,
  };
}

/**
 * Low-level polling hook used by the others. Extracted so host apps can build
 * their own endpoints without reimplementing the abort/cleanup logic.
 */
function usePolling<T>(url: string, refreshIntervalMs?: number): HookResult<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  // Keep the latest url in a ref so the interval callback always targets the current URL
  // even if the caller passes a dynamic value (rare, but safe).
  const urlRef = useRef(url);
  urlRef.current = url;

  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async (): Promise<T> => {
    controllerRef.current?.abort();
    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await getJson<T>(urlRef.current, ctrl.signal);
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw err;
      }
      setState((s) => ({ ...s, loading: false, error: err as Error }));
      throw err;
    }
  }, []);

  // `url` is a dependency, not just a ref read: `usePoolCarrierStock` (and now
  // the reserved-IP country picker) changes it as the user picks a country, and
  // without this the new URL was only picked up on the next interval tick — up
  // to 60s of stale carriers. Callers with a constant URL are unaffected.
  useEffect(() => {
    run().catch(() => {
      /* already captured in state */
    });
    if (refreshIntervalMs && refreshIntervalMs > 0) {
      const id = setInterval(() => {
        run().catch(() => {
          /* silent; state already reflects error */
        });
      }, refreshIntervalMs);
      return () => {
        clearInterval(id);
        controllerRef.current?.abort();
      };
    }
    return () => {
      controllerRef.current?.abort();
    };
  }, [run, refreshIntervalMs, url]);

  return { ...state, refetch: run };
}

/** Copy text to clipboard, falling back to a textarea hack for older browsers. */
export function useCopyToClipboard(): {
  copy: (text: string) => Promise<boolean>;
  copied: boolean;
} {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { copy, copied };
}
