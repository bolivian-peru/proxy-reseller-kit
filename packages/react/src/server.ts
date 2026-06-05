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

  const GET = async (req: Request): Promise<Response> => {
    const p = pathOf(req);
    if (p.endsWith('/me')) return handleMe(req);
    if (p.includes('/stock/carriers')) return handleCarrierStock(req);
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
