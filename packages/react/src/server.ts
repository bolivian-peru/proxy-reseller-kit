/**
 * Server-side helpers for wiring {@link PoolPortal} into a host app.
 *
 * Import from `@proxies-sx/pool-portal-react/server` (never from the main
 * entry — that would pull React into your server bundle unnecessarily).
 *
 * @packageDocumentation
 */

import type { ProxiesClient, ProxiesApiError } from '@proxies-sx/pool-sdk';
import type { MeResponse } from './types';
// Type-only import: erased at compile time, so the 'use client' module in
// hooks.ts (and React with it) never reaches your server bundle.
import type {
  AcquireLeaseInput,
  LeaseGateway,
  PoolLease,
  PoolLeaseList,
} from './hooks';

/*
 * Lease route shapes. Matched against the END of the pathname so they work
 * wherever the host mounts the handlers (`/api/pool`, `/api/proxies`, …), the
 * same convention as the `/me` and `/my-sessions` checks below.
 */
const LEASES_PATH = /\/leases$/;
const LEASE_ACTION_PATH = /\/leases\/([^/]+)\/(rotate|extend|rotation-mode|rotation-token)$/;
const LEASE_PATH = /\/leases\/([^/]+)$/;

/** Shape of the platform's `GET /private-pool/:poolId/leases` response. */
interface UpstreamLeaseList {
  enabled: boolean;
  maxLeases: number;
  held: number;
  leases: Array<PoolLease & { strings?: unknown }>;
}

/**
 * Reserved-IP (lease) wiring for a Private Pool.
 *
 * A Private Pool is a real pool record on YOUR Proxies.sx account — created
 * through the Private Pool flow, not by `poolKeys.create()`. Its leases are
 * owned by the pool, so the platform's own routes have exactly one tenant: you.
 * Per-customer scoping is therefore something only your app can do, which is
 * why {@link listUserLeaseIds} and {@link onLeaseAcquired} are required rather
 * than optional — without them every customer would see (and could release)
 * every other customer's reserved IP.
 *
 * @since 0.12.0
 */
export interface PrivatePoolLeaseOptions {
  /**
   * Id of the Private Pool the leases are carved from. Server-side only — the
   * browser never sends a pool id, so a customer cannot target another pool.
   */
  poolId: string;

  /**
   * Return the leaseIds this user owns, from YOUR database. Every lease route
   * is filtered/authorized against this list; ids outside it are answered with
   * a plain 404 (never a 403 — a customer must not be able to probe which
   * leaseIds exist).
   */
  listUserLeaseIds: (userId: string) => string[] | Promise<string[]>;

  /**
   * Persist `userId → lease.leaseId`. Called BEFORE the acquire response is
   * returned; if it throws, the handler releases the just-acquired lease and
   * fails the request, so a hold can never end up billed-but-unmapped (and
   * therefore invisible to everyone, including you).
   */
  onLeaseAcquired: (userId: string, lease: PoolLease) => void | Promise<void>;

  /** Optional: drop your mapping after a successful release. */
  onLeaseReleased?: (userId: string, leaseId: string) => void | Promise<void>;
}

/** Host-supplied hooks that let the handlers resolve who's asking and which key is theirs. */
export interface PoolApiHandlerOptions {
  /** Constructed instance of `ProxiesClient` with the reseller API key. */
  proxies: ProxiesClient;

  /**
   * Resolve the current request to an authenticated user. Return `null` if
   * not signed in — handlers will return 401.
   *
   * Example (Clerk): `() => auth()?.userId ?? null`
   * Example (NextAuth): `async () => (await getServerSession(authOptions))?.user?.id ?? null`
   */
  getSessionUserId: (req: Request) => string | null | Promise<string | null>;

  /**
   * Return the `pakKeyId` (Mongo id of the Pool Access Key) belonging to this user,
   * or `null` if they don't have one yet. The handler looks up current usage
   * via the SDK.
   */
  getUserKeyId: (userId: string) => string | null | Promise<string | null>;

  /**
   * Optional: override the gateway host included in the response. Passed
   * through to the browser so `buildProxyUrl` points at your edge if you
   * run one.
   */
  gatewayHost?: string;

  /**
   * Optional: called after any write (e.g. regenerate) so hosts can log audit events.
   */
  onAudit?: (event: {
    type: string;
    userId: string;
    keyId?: string;
    sessionKey?: string;
    count?: number;
    leaseId?: string;
  }) => void | Promise<void>;

  /**
   * Enable the Reserved-IP (lease) routes. Omit to leave them off — every
   * `/leases*` path then 404s exactly as it does today.
   *
   * @since 0.12.0
   */
  privatePool?: PrivatePoolLeaseOptions;
}

interface RouteHandlers {
  /** Handler for `GET /api/pool/me`. */
  GET: (req: Request) => Promise<Response>;
  /** Handler for any non-read verbs on nested paths (regenerate, etc.). */
  POST: (req: Request) => Promise<Response>;
  /** Handler for session-close routes (added in 0.4.0). */
  DELETE: (req: Request) => Promise<Response>;
}

/**
 * Factory that returns Next.js App Router handlers for the PoolPortal.
 *
 * Mount at `app/api/pool/[[...path]]/route.ts`:
 *
 * ```ts
 * import { createPoolApiHandlers } from '@proxies-sx/pool-portal-react/server';
 * import { ProxiesClient } from '@proxies-sx/pool-sdk';
 * import { auth } from '@/lib/auth';
 * import { db } from '@/lib/db';
 *
 * export const { GET, POST } = createPoolApiHandlers({
 *   proxies: new ProxiesClient({
 *     apiKey: process.env.PROXIES_SX_API_KEY!,
 *     proxyUsername: process.env.PROXIES_SX_USERNAME!,
 *   }),
 *   getSessionUserId: () => auth()?.userId ?? null,
 *   getUserKeyId: async (uid) => (await db.customers.get(uid))?.pakKeyId ?? null,
 * });
 * ```
 *
 * Exposes:
 * - `GET  /api/pool/me`         — current user's pak_ + usage (auth required)
 * - `GET  /api/pool/stock`      — public pool stock
 * - `GET  /api/pool/incidents`  — public incidents
 * - `POST /api/pool/regenerate` — rotate current user's key (auth required)
 *
 * With `privatePool` configured, Reserved IPs are exposed too (all auth
 * required, all scoped to the caller via `listUserLeaseIds`):
 * - `GET    /api/pool/leases`
 * - `POST   /api/pool/leases`                        — reserve one IP
 * - `POST   /api/pool/leases/:id/rotate`
 * - `POST   /api/pool/leases/:id/extend`
 * - `POST   /api/pool/leases/:id/rotation-mode`
 * - `POST   /api/pool/leases/:id/rotation-token`     — issue / regenerate link
 * - `DELETE /api/pool/leases/:id/rotation-token`     — revoke link
 * - `DELETE /api/pool/leases/:id`                    — release the hold
 *
 * Note the verbs: rotation-mode is a POST here even though the platform route
 * is a PATCH, so a host only ever has to export `{ GET, POST, DELETE }`.
 */
export function createPoolApiHandlers(options: PoolApiHandlerOptions): RouteHandlers {
  const {
    proxies,
    getSessionUserId,
    getUserKeyId,
    gatewayHost,
    onAudit,
    privatePool,
  } = options;

  if (!proxies.proxyUsername) {
    throw new Error(
      'createPoolApiHandlers: ProxiesClient was constructed without a `proxyUsername`. ' +
        'Set it in the ClientConfig — handlers need it to return the public reseller id.',
    );
  }

  const json = (data: unknown, init?: ResponseInit): Response =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });

  const pathOf = (req: Request): string => {
    try {
      const u = new URL(req.url);
      // Strip a trailing slash for consistent matching
      return u.pathname.replace(/\/+$/, '');
    } catch {
      return '';
    }
  };

  const handleMe = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const keyId = await getUserKeyId(userId);
    if (!keyId) return json({ error: 'no_key' }, { status: 404 });

    let key;
    try {
      // Single-key fetch via SDK 0.3.0+ (avoid the list+filter pattern —
      // O(N) on the platform side and unnecessary now that `get()` exists).
      key = await proxies.poolKeys.get(keyId);
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      // 404 = key was deleted on the platform but our local mapping still
      // points at it. Surface as `key_missing` so the dashboard can ask
      // the user to repurchase, instead of bubbling a 502.
      if (apiErr.status === 404) {
        return json({ error: 'key_missing' }, { status: 404 });
      }
      return json(
        { error: 'upstream_error', status: apiErr.status ?? 500 },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }

    const response: MeResponse = {
      proxyUsername: proxies.proxyUsername!,
      pakKey: key.key,
      pakKeyId: key.id,
      usage: {
        usedMB: key.trafficUsedMB,
        usedGB: key.trafficUsedGB ?? key.trafficUsedMB / 1024,
        capGB: key.trafficCapGB,
        enabled: key.enabled,
        lastUsedAt: key.lastUsedAt,
      },
      ...(gatewayHost ? { gatewayHost } : {}),
    };
    return json(response, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  };

  const handleStock = async (): Promise<Response> => {
    try {
      const stock = await proxies.pool.getStock();
      return json(stock, { headers: { 'Cache-Control': 'public, max-age=30' } });
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  const handleCarrierStock = async (req: Request): Promise<Response> => {
    const country = new URL(req.url).searchParams.get('country') ?? '';
    if (!country) {
      return json({ error: 'country_required' }, { status: 400 });
    }
    try {
      const stock = await proxies.pool.getCarrierStock(country);
      return json(stock, { headers: { 'Cache-Control': 'public, max-age=30' } });
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  const handleCities = async (req: Request): Promise<Response> => {
    const sp = new URL(req.url).searchParams;
    const country = sp.get('country') ?? '';
    if (!country) {
      return json({ error: 'country_required' }, { status: 400 });
    }
    const pool = sp.get('pool');
    try {
      const cities = await proxies.pool.getCities(
        country,
        pool === 'mbl' || pool === 'all' || pool === 'peer' ? { pool } : undefined,
      );
      return json(cities, { headers: { 'Cache-Control': 'public, max-age=30' } });
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  const handleFacets = async (req: Request): Promise<Response> => {
    const sp = new URL(req.url).searchParams;
    const country = sp.get('country') ?? '';
    if (!country) {
      return json({ error: 'country_required' }, { status: 400 });
    }
    const pool = sp.get('pool');
    try {
      const facets = await proxies.pool.getFacets({
        country,
        pool: pool === 'mbl' || pool === 'all' || pool === 'peer' ? pool : undefined,
        city: sp.get('city') ?? undefined,
        state: sp.get('state') ?? undefined,
        carrier: sp.get('carrier') ?? undefined,
      });
      return json(facets, { headers: { 'Cache-Control': 'public, max-age=15' } });
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  const handleIncidents = async (): Promise<Response> => {
    try {
      const incidents = await proxies.pool.getIncidents();
      return json(incidents, { headers: { 'Cache-Control': 'public, max-age=60' } });
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  /**
   * GET /me/sessions — the CURRENT user's live gateway sessions only.
   *
   * MUST be scoped by the user's own pak: `proxies.sessions.list()` uses the
   * reseller's API key and would otherwise return EVERY customer's sessions.
   * We resolve the caller's key id via `getUserKeyId` and pass it as `pakId`
   * so the platform filters server-side. A user without a key has no sessions.
   */
  const handleListSessions = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const keyId = await getUserKeyId(userId);
    if (!keyId) {
      return json({ sessions: [], count: 0 }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    try {
      const result = await proxies.sessions.list({ pakId: keyId });
      return json(result, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  /**
   * DELETE /me/sessions/:sessionKey — closes one session the caller owns.
   * Scoped by the caller's pak (`pakId`) so a customer cannot close a
   * co-tenant's session; the platform returns "not found" on a mismatch.
   */
  const handleCloseSession = async (
    req: Request,
    sessionKey: string,
  ): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const keyId = await getUserKeyId(userId);
    if (!keyId) return json({ success: false, message: 'Session not found' });

    try {
      const result = await proxies.sessions.close(sessionKey, { pakId: keyId });
      if (onAudit) {
        await onAudit({ type: 'session.closed', userId, sessionKey });
      }
      return json(result);
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  /**
   * DELETE /me/sessions — closes ALL of the CURRENT user's sessions only.
   * Scoped by the caller's pak (`pakId`) so this never closes other customers'
   * sessions under the same reseller API key.
   */
  const handleCloseAllSessions = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const keyId = await getUserKeyId(userId);
    if (!keyId) return json({ success: true, message: 'No sessions', count: 0 });

    try {
      const result = await proxies.sessions.closeAll({ pakId: keyId });
      if (onAudit) {
        await onAudit({ type: 'sessions.closed_all', userId, count: result.count });
      }
      return json(result);
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  const handleRegenerate = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const keyId = await getUserKeyId(userId);
    if (!keyId) return json({ error: 'no_key' }, { status: 404 });

    try {
      const result = await proxies.poolKeys.regenerate(keyId);
      if (onAudit) {
        await onAudit({ type: 'key.regenerated', userId, keyId });
      }
      return json(result);
    } catch (err) {
      const apiErr = err as ProxiesApiError;
      return json(
        { error: 'upstream_error' },
        { status: apiErr.status && apiErr.status < 600 ? apiErr.status : 502 },
      );
    }
  };

  /* ── Reserved IPs (Private Pool leases) ─────────────────────────────────
   *
   * The platform's lease routes are single-tenant: they authorize the POOL
   * OWNER (your reseller account), not your customers. Everything below adds
   * the per-customer scoping the platform cannot do — resolve the session, ask
   * the host which leaseIds belong to that customer, and answer anything
   * outside that set with a plain 404.
   *
   * The SDK has no leases API yet, so these go through the client's low-level
   * `request()` — retry, timeout and `ProxiesApiError` typing still apply.
   */

  /** Forward the platform's own sentence ("No free device in US right now…") to the browser. */
  const upstreamError = (err: unknown): Response => {
    const apiErr = err as ProxiesApiError;
    const status =
      typeof apiErr?.status === 'number' && apiErr.status >= 400 && apiErr.status < 600
        ? apiErr.status
        : 502;
    const raw = (apiErr?.data as { message?: unknown } | undefined)?.message;
    let message: string | undefined;
    if (typeof raw === 'string') message = raw;
    else if (Array.isArray(raw)) message = raw.filter((m) => typeof m === 'string').join('. ');
    return json(
      { error: 'upstream_error', status, ...(message ? { message } : {}) },
      { status },
    );
  };

  const leasePath = (leaseId: string, suffix = ''): string =>
    `/private-pool/leases/${encodeURIComponent(leaseId)}${suffix}`;

  const readJsonBody = async (req: Request): Promise<Record<string, unknown>> => {
    try {
      return ((await req.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  };

  /**
   * Drop the platform's pre-built `strings` block. Its password is a masked
   * `pak_********` placeholder, so it isn't usable as-is, and shipping it would
   * give the browser a second, competing source for the connection string —
   * the component builds the real one with `buildProxyUrl`.
   */
  const stripLease = (row: PoolLease & { strings?: unknown }): PoolLease => {
    const { strings: _platformStrings, ...lease } = row;
    return lease;
  };

  // Routing facts for the pool's credentials. Cached because they only change
  // if the pool itself is rebuilt, and the dashboard polls the lease list every
  // 15s. Failures are NOT cached — a blip must not blank credentials for 5 min.
  const GATEWAY_CACHE_MS = 300_000;
  let gatewayCache: { at: number; value: LeaseGateway } | null = null;

  const loadLeaseGateway = async (poolId: string): Promise<LeaseGateway | null> => {
    if (gatewayCache && Date.now() - gatewayCache.at < GATEWAY_CACHE_MS) {
      return gatewayCache.value;
    }
    interface UpstreamPoolRow {
      pool: { id: string; countries?: string[]; allowedCountries?: string[] };
      connection: {
        proxyUsername: string;
        poolToken: LeaseGateway['poolToken'];
        host: string;
        countries?: string[];
      } | null;
    }
    const rows = await proxies.request<UpstreamPoolRow[]>('/private-pool/pools');
    const row = rows.find((r) => String(r.pool?.id) === poolId);
    if (!row?.connection) return null;
    const countries =
      row.connection.countries ?? row.pool.allowedCountries ?? row.pool.countries ?? [];
    const value: LeaseGateway = {
      proxyUsername: row.connection.proxyUsername,
      poolToken: row.connection.poolToken,
      // A host-configured edge wins, same as the `/me` response.
      host: gatewayHost ?? row.connection.host,
      countries: countries.map((c) => c.toUpperCase()),
    };
    gatewayCache = { at: Date.now(), value };
    return value;
  };

  /** Resolve + authorize a lease-scoped request. */
  const authorizeLease = async (
    req: Request,
    leaseId: string,
  ): Promise<{ userId: string } | { response: Response }> => {
    const userId = await getSessionUserId(req);
    if (!userId) return { response: json({ error: 'unauthorized' }, { status: 401 }) };
    const owned = await privatePool!.listUserLeaseIds(userId);
    if (!owned.includes(leaseId)) {
      // 404 and not 403 — a customer must not be able to probe which leaseIds exist.
      return { response: json({ error: 'not_found' }, { status: 404 }) };
    }
    return { userId };
  };

  // Every dashboard polls this list, but the pool it reads is the SAME for all
  // of them — so one upstream read serves everyone in the window. Without it a
  // reseller with 50 open dashboards makes ~200 identical calls a minute from a
  // single server IP and trips the platform's rate limiter. Mutations
  // invalidate the cache, so a rotate or release still shows up immediately.
  const LEASE_LIST_CACHE_MS = 5_000;
  let leaseListCache: { at: number; value: UpstreamLeaseList } | null = null;

  const loadLeaseList = async (): Promise<UpstreamLeaseList> => {
    if (leaseListCache && Date.now() - leaseListCache.at < LEASE_LIST_CACHE_MS) {
      return leaseListCache.value;
    }
    const value = await proxies.request<UpstreamLeaseList>(
      `/private-pool/${encodeURIComponent(privatePool!.poolId)}/leases`,
    );
    leaseListCache = { at: Date.now(), value };
    return value;
  };

  const invalidateLeaseList = (): void => {
    leaseListCache = null;
  };

  const handleListLeases = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const owned = new Set(await privatePool!.listUserLeaseIds(userId));
    try {
      const upstream = await loadLeaseList();
      const mine = (upstream.leases ?? [])
        .filter((l) => owned.has(l.leaseId))
        .map(stripLease);
      // Credentials are useless without the routing facts, but a hold is still
      // worth showing — so a gateway lookup failure degrades to `null`, not 502.
      const gateway = await loadLeaseGateway(privatePool!.poolId).catch(() => null);
      const body: PoolLeaseList = {
        enabled: upstream.enabled,
        maxLeases: upstream.maxLeases,
        poolHeld: upstream.held,
        held: mine.length,
        leases: mine,
        gateway,
      };
      return json(body, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
      return upstreamError(err);
    }
  };

  const handleAcquireLease = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const body = (await readJsonBody(req)) as unknown as AcquireLeaseInput;
    if (!body?.country) {
      return json({ error: 'country_required', message: 'Pick a country to reserve in.' }, { status: 400 });
    }

    let lease: PoolLease;
    try {
      lease = await proxies.request<PoolLease>(
        `/private-pool/${encodeURIComponent(privatePool!.poolId)}/leases`,
        {
          method: 'POST',
          body: JSON.stringify({
            country: body.country,
            carrier: body.carrier,
            ipType: body.ipType,
            idleTtlSec: body.idleTtlSec,
            failover: body.failover,
          }),
        },
      );
    } catch (err) {
      return upstreamError(err);
    }
    invalidateLeaseList();

    // Record the mapping BEFORE answering. A hold the host never persisted is
    // invisible to `listUserLeaseIds`, so nobody — not even you — could list or
    // release it, while it still occupies a slot and bills. Undo instead.
    try {
      await privatePool!.onLeaseAcquired(userId, lease);
    } catch {
      await proxies
        .request(leasePath(lease.leaseId), { method: 'DELETE' })
        .catch(() => {
          // Best effort. If this also fails the platform's idle reaper returns
          // the device to the pool after the lease's idle window.
        });
      return json(
        {
          error: 'lease_persist_failed',
          message: 'Could not record the reservation, so it was released. Please try again.',
        },
        { status: 500 },
      );
    }

    if (onAudit) {
      await onAudit({ type: 'lease.acquired', userId, leaseId: lease.leaseId });
    }
    return json(stripLease(lease), { headers: { 'Cache-Control': 'private, no-store' } });
  };

  /** Authorize, then pass one lease mutation through to the platform. */
  const forwardLeaseCall = async (
    req: Request,
    leaseId: string,
    upstreamPath: string,
    method: string,
    upstreamBody?: unknown,
  ): Promise<Response> => {
    const auth = await authorizeLease(req, leaseId);
    if ('response' in auth) return auth.response;
    try {
      const result = await proxies.request<unknown>(upstreamPath, {
        method,
        ...(upstreamBody === undefined ? {} : { body: JSON.stringify(upstreamBody) }),
      });
      invalidateLeaseList();
      return json(result ?? { ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (err) {
      return upstreamError(err);
    }
  };

  const handleReleaseLease = async (req: Request, leaseId: string): Promise<Response> => {
    const auth = await authorizeLease(req, leaseId);
    if ('response' in auth) return auth.response;
    try {
      const result = await proxies.request<unknown>(leasePath(leaseId), { method: 'DELETE' });
      invalidateLeaseList();
      if (privatePool!.onLeaseReleased) {
        await privatePool!.onLeaseReleased(auth.userId, leaseId);
      }
      if (onAudit) {
        await onAudit({ type: 'lease.released', userId: auth.userId, leaseId });
      }
      return json(result ?? { released: true });
    } catch (err) {
      return upstreamError(err);
    }
  };

  const GET = async (req: Request): Promise<Response> => {
    const p = pathOf(req);
    if (p.endsWith('/me')) return handleMe(req);
    if (p.includes('/stock/carriers')) return handleCarrierStock(req);
    if (p.includes('/stock/cities')) return handleCities(req);
    if (p.includes('/stock/facets')) return handleFacets(req);
    if (p.endsWith('/stock')) return handleStock();
    if (p.endsWith('/incidents')) return handleIncidents();
    if (p.endsWith('/my-sessions')) return handleListSessions(req);
    if (privatePool && LEASES_PATH.test(p)) return handleListLeases(req);
    return json({ error: 'not_found' }, { status: 404 });
  };

  const POST = async (req: Request): Promise<Response> => {
    const p = pathOf(req);
    if (p.endsWith('/regenerate')) return handleRegenerate(req);
    if (privatePool) {
      if (LEASES_PATH.test(p)) return handleAcquireLease(req);
      const action = LEASE_ACTION_PATH.exec(p);
      if (action) {
        const leaseId = decodeURIComponent(action[1]!);
        switch (action[2]) {
          case 'rotate':
            return forwardLeaseCall(req, leaseId, leasePath(leaseId, '/rotate'), 'POST');
          case 'extend': {
            const body = await readJsonBody(req);
            const idleTtlSec = Number(body.idleTtlSec);
            // The platform falls back to 1800 on a non-number, which would
            // silently change the customer's window to something they never
            // picked — reject instead. (It still clamps to [600, 43200].)
            if (!Number.isFinite(idleTtlSec)) {
              return json(
                { error: 'invalid_idle_ttl', message: 'idleTtlSec must be a number of seconds.' },
                { status: 400 },
              );
            }
            return forwardLeaseCall(req, leaseId, leasePath(leaseId, '/extend'), 'POST', {
              idleTtlSec,
            });
          }
          case 'rotation-mode': {
            const body = await readJsonBody(req);
            // POST here, PATCH upstream — see the factory's route table.
            return forwardLeaseCall(req, leaseId, leasePath(leaseId, '/rotation-mode'), 'PATCH', {
              mode: String(body.mode ?? ''),
            });
          }
          case 'rotation-token':
            return forwardLeaseCall(req, leaseId, leasePath(leaseId, '/rotation-token'), 'POST');
        }
      }
    }
    return json({ error: 'not_found' }, { status: 404 });
  };

  /**
   * DELETE /my-sessions                    — close all
   * DELETE /my-sessions/<key>              — close one
   * DELETE /leases/<id>/rotation-token     — revoke that lease's public link
   * DELETE /leases/<id>                    — release the hold
   */
  const DELETE = async (req: Request): Promise<Response> => {
    const p = pathOf(req);
    // /my-sessions exactly → closeAll. /my-sessions/<key> → close one.
    const m = p.match(/\/my-sessions(?:\/(.+))?$/);
    if (m) {
      const sessionKey = m[1] ? decodeURIComponent(m[1]) : '';
      if (!sessionKey) return handleCloseAllSessions(req);
      return handleCloseSession(req, sessionKey);
    }
    if (privatePool) {
      // Match the action route FIRST — `/leases/<id>` would swallow
      // `/leases/<id>/rotation-token` and release the whole hold instead.
      const action = LEASE_ACTION_PATH.exec(p);
      if (action && action[2] === 'rotation-token') {
        const leaseId = decodeURIComponent(action[1]!);
        return forwardLeaseCall(req, leaseId, leasePath(leaseId, '/rotation-token'), 'DELETE');
      }
      const one = LEASE_PATH.exec(p);
      if (one) return handleReleaseLease(req, decodeURIComponent(one[1]!));
    }
    return json({ error: 'not_found' }, { status: 404 });
  };

  return { GET, POST, DELETE };
}
