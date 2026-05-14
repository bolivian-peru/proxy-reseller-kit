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
  }) => void | Promise<void>;
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
 */
export function createPoolApiHandlers(options: PoolApiHandlerOptions): RouteHandlers {
  const {
    proxies,
    getSessionUserId,
    getUserKeyId,
    gatewayHost,
    onAudit,
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
   * Resolve the customer's pak_ value (not just the keyId) so session
   * routes can scope by pakId. Returns null if the customer has no key
   * — handlers short-circuit with 404 in that case.
   *
   * Cached implicitly via the SDK's request layer; one extra round-trip
   * per session-route call is acceptable given how rarely customers open
   * the sessions tab.
   */
  const resolveCustomerPak = async (userId: string): Promise<string | null> => {
    const keyId = await getUserKeyId(userId);
    if (!keyId) return null;
    try {
      const key = await proxies.poolKeys.get(keyId);
      return key.key ?? null;
    } catch {
      return null;
    }
  };

  /**
   * GET /my-sessions — proxies to SDK `client.sessions.list(pakKey)`.
   *
   * Scoping (May 2026 — closes cross-customer session-list leak):
   * the upstream `/v1/gateway/pool/my-sessions` filters by the API-key
   * owner = the reseller, not the end-customer. We must pass the
   * customer's pak_ as `?pakId=` so the upstream filters down to just
   * THIS customer's sessions. Without it, customer A would see every
   * other customer's sessions inside the same reseller.
   */
  const handleListSessions = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const pakKey = await resolveCustomerPak(userId);
    if (!pakKey) return json({ error: 'no_key' }, { status: 404 });

    try {
      const result = await proxies.sessions.list(pakKey);
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
   * DELETE /my-sessions/:sessionKey — closes one session.
   *
   * Ownership re-check (May 2026): the upstream close route ONLY checks
   * that the sessionKey belongs to the API-key owner (= the reseller),
   * not to the requesting customer. We therefore list the customer's
   * own sessions first (scoped by their pak_) and refuse to close any
   * sessionKey that doesn't appear there. Otherwise a customer who
   * discovered another customer's sessionKey could close it.
   */
  const handleCloseSession = async (
    req: Request,
    sessionKey: string,
  ): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const pakKey = await resolveCustomerPak(userId);
    if (!pakKey) return json({ error: 'no_key' }, { status: 404 });

    try {
      // Ownership re-check: only allow closing keys in this customer's scope.
      const scoped = await proxies.sessions.list(pakKey);
      const owned = scoped.sessions?.some((s: any) => s.sessionKey === sessionKey);
      if (!owned) {
        return json({ error: 'not_found' }, { status: 404 });
      }

      const result = await proxies.sessions.close(sessionKey);
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
   * DELETE /my-sessions — closes ALL of the current customer's sessions.
   *
   * Scoping (May 2026): the upstream closeAll closes every session for
   * the API-key owner — i.e. EVERY customer of this reseller. That's
   * catastrophic. We instead list the customer's scoped sessions and
   * close them one-by-one with the per-session ownership re-check.
   */
  const handleCloseAllSessions = async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId(req);
    if (!userId) return json({ error: 'unauthorized' }, { status: 401 });

    const pakKey = await resolveCustomerPak(userId);
    if (!pakKey) return json({ error: 'no_key' }, { status: 404 });

    try {
      const scoped = await proxies.sessions.list(pakKey);
      const keys: string[] = (scoped.sessions || [])
        .map((s: any) => s.sessionKey)
        .filter(Boolean);

      let closed = 0;
      for (const k of keys) {
        try {
          const r = await proxies.sessions.close(k);
          if (r?.success) closed++;
        } catch {
          // Best-effort — keep closing the rest.
        }
      }

      if (onAudit) {
        await onAudit({ type: 'sessions.closed_all', userId, count: closed });
      }
      return json({ success: true, message: 'ok', count: closed });
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

  const GET = async (req: Request): Promise<Response> => {
    const p = pathOf(req);
    if (p.endsWith('/me')) return handleMe(req);
    if (p.endsWith('/stock')) return handleStock();
    if (p.endsWith('/incidents')) return handleIncidents();
    if (p.endsWith('/my-sessions')) return handleListSessions(req);
    return json({ error: 'not_found' }, { status: 404 });
  };

  const POST = async (req: Request): Promise<Response> => {
    const p = pathOf(req);
    if (p.endsWith('/regenerate')) return handleRegenerate(req);
    return json({ error: 'not_found' }, { status: 404 });
  };

  /**
   * DELETE /my-sessions          — close all
   * DELETE /my-sessions/<key>    — close one
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
    return json({ error: 'not_found' }, { status: 404 });
  };

  return { GET, POST, DELETE };
}
