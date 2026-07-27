'use client';

import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useState,
} from 'react';
import type { ActiveSession } from '@proxies-sx/pool-sdk';
import { finiteOr, useCopyToClipboard } from './hooks';
import type { Branding, PoolPortalClassNames } from './types';

/**
 * Props for {@link ActiveSessionsTable}.
 *
 * @public
 */
export interface ActiveSessionsTableProps {
  /** Base path of your mounted `createPoolApiHandlers()`. Default `/api/pool`. */
  apiRoute?: string;
  /**
   * The customer's password to substitute into proxy URLs when copying.
   * Either a `pak_` key or a `proxyPassword`. Held in component state
   * only — never logged or sent server-side.
   */
  proxyPassword: string;
  /** Auto-refresh interval in ms. Default 5000. Set 0 to disable polling. */
  refreshIntervalMs?: number;
  /**
   * Hide synthesized-sid sessions (`auto_*`/`socks5_*`). These are
   * created when a customer connects without `-sid-` and have a 5-min
   * TTL. Default true — they're internal and not user-actionable.
   */
  hideSynthesizedSessions?: boolean;
  /** Called with the closed sessionKey after a successful close. */
  onSessionClosed?: (sessionKey: string) => void;
  /** Called with the count after closeAll resolves. */
  onAllSessionsClosed?: (count: number) => void;
  /** Called when a copy succeeds. */
  onCopy?: (url: string) => void;
  /** Branding (CSS custom properties). */
  branding?: Branding;
  /** Per-part className overrides. */
  classNames?: PoolPortalClassNames;
  /** Extra class on root. */
  className?: string;
  /** Inline style on root. */
  style?: CSSProperties;
}

/**
 * Live table of the current user's gateway sessions. Polls
 * `GET <apiRoute>/my-sessions` at `refreshIntervalMs` (default 5 s).
 *
 * Each row exposes:
 * - The exit IP (updates as rotation fires).
 * - Per-session traffic (bytes in/out, request count).
 * - TTL countdown (when Redis will auto-evict).
 * - Copy-URL button (substitutes `<PASSWORD>` with `proxyPassword`).
 * - Close button — calls `DELETE <apiRoute>/my-sessions/:sessionKey`.
 *
 * Sessions auto-close on TTL — manual close is only for releasing the
 * pinned IP early.
 *
 * @example
 * ```tsx
 * <ActiveSessionsTable
 *   apiRoute="/api/pool"
 *   proxyPassword={me.pakKey}
 *   refreshIntervalMs={5000}
 *   onSessionClosed={(key) => toast.success(`Closed ${key.slice(-12)}`)}
 * />
 * ```
 *
 * @public
 */
export function ActiveSessionsTable(props: ActiveSessionsTableProps): JSX.Element {
  const {
    apiRoute = '/api/pool',
    proxyPassword,
    refreshIntervalMs = 5_000,
    hideSynthesizedSessions = true,
    onSessionClosed,
    onAllSessionsClosed,
    onCopy,
    branding,
    classNames = {},
    className,
    style,
  } = props;

  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Reuses the package's clipboard hook — it owns the permission handling, the
  // execCommand fallback for non-secure origins, the "Copied" timer and that
  // timer's unmount cleanup. `copied` below is that hook's flag; `copiedKey`
  // only records WHICH row it belongs to.
  const { copy, copied } = useCopyToClipboard();

  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch(`${apiRoute}/my-sessions`, { credentials: 'same-origin' });
      if (!r.ok) {
        // Don't blow away prior state — surface the error but keep last-known sessions.
        setError(`Failed to load sessions (HTTP ${r.status})`);
        return;
      }
      const body = (await r.json()) as { sessions?: unknown };
      // A non-array `sessions` (error envelope, HTML proxy page parsed as JSON)
      // would take `.filter`/`.map` down with it — the table is the only thing
      // standing between a malformed response and the host app's whole tree.
      // Non-object ENTRIES are dropped for the same reason: one `null` in the
      // array is enough to throw on `s.isSynthesizedSid` a line later.
      setSessions(
        Array.isArray(body.sessions)
          ? body.sessions.filter(
              (s): s is ActiveSession => typeof s === 'object' && s !== null,
            )
          : [],
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [apiRoute]);

  useEffect(() => {
    fetchSessions();
    if (refreshIntervalMs <= 0) return;
    const id = setInterval(fetchSessions, refreshIntervalMs);
    return () => clearInterval(id);
  }, [fetchSessions, refreshIntervalMs]);

  const handleClose = useCallback(async (sessionKey: string) => {
    if (!sessionKey) return;
    setClosingKey(sessionKey);
    try {
      const r = await fetch(`${apiRoute}/my-sessions/${encodeURIComponent(sessionKey)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (r.ok) {
        onSessionClosed?.(sessionKey);
        // Optimistically remove — next poll will reconcile.
        setSessions((prev) => prev.filter((s) => s.sessionKey !== sessionKey));
      }
    } finally {
      setClosingKey(null);
    }
  }, [apiRoute, onSessionClosed]);

  const handleCloseAll = useCallback(async () => {
    if (!confirm('Close all active sessions? This terminates every live connection — including ones you may still be using.')) return;
    setClosingAll(true);
    try {
      const r = await fetch(`${apiRoute}/my-sessions`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (r.ok) {
        const body = (await r.json()) as { count?: number };
        // Hosts put this straight into a toast — "Closed NaN sessions" is a
        // worse outcome than falling back to what we last rendered.
        onAllSessionsClosed?.(finiteOr(body.count, sessions.length));
        setSessions([]);
      }
    } finally {
      setClosingAll(false);
    }
  }, [apiRoute, onAllSessionsClosed, sessions.length]);

  const handleCopy = useCallback(async (session: ActiveSession) => {
    // The gateway emits an empty proxyUrl when the Redis row has no accountId
    // (`gateway/src/index.ts` — "corrupted writes, partial migrations"). The
    // button is disabled in that case; this is the belt to that suspenders.
    if (!session.proxyUrl) return;
    setCopyError(null);
    const url = session.proxyUrl.replace('<PASSWORD>', encodeURIComponent(proxyPassword));
    // The old code fired `void navigator.clipboard.writeText()` and flipped to
    // "Copied" regardless — so a denied permission, an insecure origin or a
    // dismissed prompt all sent the customer off to paste nothing. The hook
    // resolves false in exactly those cases.
    const ok = await copy(url);
    if (!ok) {
      setCopyError('Clipboard blocked by the browser — select the URL and copy it manually.');
      return;
    }
    onCopy?.(url);
    setCopiedKey(session.sessionKey);
  }, [copy, proxyPassword, onCopy]);

  const visible = hideSynthesizedSessions
    ? sessions.filter((s) => !s.isSynthesizedSid)
    : sessions;

  return (
    <div
      className={cn('psx', 'psx-sessions', classNames.root, className)}
      style={brandingToStyle(branding, style)}
    >
      <div className="psx-sessions-header">
        <h3 className="psx-sessions-title">
          Active sessions
          {visible.length > 0 && <span className="psx-sessions-count"> ({visible.length})</span>}
        </h3>
        <div className="psx-sessions-actions">
          <button
            type="button"
            onClick={fetchSessions}
            className={cn('psx-button', 'psx-button-ghost', classNames.button)}
            disabled={loading}
            aria-busy={loading}
          >
            Refresh
          </button>
          {visible.length > 0 && (
            <button
              type="button"
              onClick={handleCloseAll}
              disabled={closingAll}
              aria-busy={closingAll}
              className={cn('psx-button', 'psx-button-danger', classNames.button)}
            >
              {closingAll ? 'Closing…' : 'Close all'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="psx-sessions-error" role="status">{error}</p>}
      {copyError && <p className="psx-sessions-error" role="status">{copyError}</p>}

      {!loading && visible.length === 0 && (
        <p className="psx-sessions-empty">
          No active sessions. Open a connection to <code>gw.proxies.sx</code> with your proxy URL —
          it'll appear here within a few seconds.
        </p>
      )}

      {visible.length > 0 && (
        <table className={cn('psx-sessions-table', classNames.card)}>
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Sid</th>
              <th scope="col">IP</th>
              <th scope="col">Rotation</th>
              <th scope="col">Started</th>
              <th scope="col">TTL</th>
              <th scope="col">Bytes</th>
              <th scope="col">Reqs</th>
              <th scope="col" aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s, index) => {
              const isClosing = closingKey === s.sessionKey;
              // EVERY read below is defensive on purpose. The gateway builds
              // this row straight out of a Redis `hgetall` with no per-field
              // defaults — strings come through as `undefined` and the numbers
              // as `NaN` (`parseInt(undefined, 10)`). One `undefined.toLowerCase()`
              // here unmounts the host app's whole tree.
              const cc = typeof s.country === 'string' ? s.country.toLowerCase() : '';
              const flag = COUNTRY_FLAGS[cc] ?? '🌐';
              const rowLabel = s.sessionId || cc.toUpperCase() || 'this session';
              const canCopy = Boolean(s.proxyUrl);
              return (
                <tr key={s.sessionKey || `${s.sessionId ?? 'row'}:${index}`}>
                  <td>
                    {flag} {cc ? cc.toUpperCase() : '—'}
                    {s.pool && <span className="psx-sessions-pool">/{s.pool}</span>}
                  </td>
                  <td><code>{s.sessionId || '—'}</code></td>
                  <td><code className="psx-sessions-ip">{s.currentIp || '—'}</code></td>
                  <td>{s.rotation || 'auto10'}</td>
                  <td title={isoTimestamp(s.createdAt)}>{relativeTime(s.createdAt)}</td>
                  <td title={expiryTitle(s.expiresAt)}>{formatTtl(s.ttl)}</td>
                  <td>↓ {formatBytes(s.bytesIn)} / ↑ {formatBytes(s.bytesOut)}</td>
                  <td>{Number.isFinite(s.requestCount) ? s.requestCount : '—'}</td>
                  <td className="psx-sessions-row-actions">
                    <button
                      type="button"
                      onClick={() => { void handleCopy(s); }}
                      disabled={!canCopy}
                      aria-label={`Copy proxy URL for ${rowLabel}`}
                      title={canCopy ? undefined : 'This session row is incomplete — no proxy URL to copy.'}
                      className={cn('psx-button', 'psx-button-ghost', classNames.button)}
                    >
                      {copied && copiedKey === s.sessionKey ? 'Copied' : 'Copy URL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void handleClose(s.sessionKey); }}
                      disabled={isClosing || !s.sessionKey}
                      aria-busy={isClosing}
                      aria-label={`Close ${rowLabel}`}
                      className={cn('psx-button', 'psx-button-danger', classNames.button)}
                    >
                      {isClosing ? 'Closing…' : 'Close'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <p className="psx-sessions-help">
        Sessions auto-close on TTL — closing manually is only needed if you want the IP released
        before the timer fires. Synthesized-sid sessions (5-min TTL) are hidden.
      </p>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const COUNTRY_FLAGS: Record<string, string> = {
  us: '\u{1F1FA}\u{1F1F8}', de: '\u{1F1E9}\u{1F1EA}', gb: '\u{1F1EC}\u{1F1E7}',
  es: '\u{1F1EA}\u{1F1F8}', fr: '\u{1F1EB}\u{1F1F7}', pl: '\u{1F1F5}\u{1F1F1}',
  ch: '\u{1F1E8}\u{1F1ED}', pa: '\u{1F1F5}\u{1F1E6}', am: '\u{1F1E6}\u{1F1F2}',
};

/*
 * Every numeric formatter below funnels through the shared `finiteOr`: the
 * gateway parses each session field with `parseInt(value, 10)` over a raw
 * Redis `hgetall`, so a missing field arrives as `NaN` — not `undefined` —
 * and `?? 0` does not catch that. It is how "NaN GB" and "NaN h" reached the
 * table.
 */

function formatBytes(n: number | undefined): string {
  const v = finiteOr(n, 0);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTtl(seconds: number | undefined): string {
  if (!Number.isFinite(seconds)) return '—';
  const s = finiteOr(seconds, 0);
  if (s <= 0) return 'expired';
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 360) / 10} h`;
}

function relativeTime(unixMs: number | undefined): string {
  if (!Number.isFinite(unixMs)) return '—';
  const diff = Date.now() - (unixMs as number);
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  return `${Math.round(diff / 3_600_000)} h ago`;
}

/**
 * `new Date(NaN).toISOString()` throws a `RangeError` — an unguarded tooltip
 * is enough to take the table down. Returning `undefined` omits the `title`
 * attribute entirely, which is the correct "we don't know" rendering.
 */
function isoTimestamp(unixMs: number | undefined): string | undefined {
  if (!Number.isFinite(unixMs)) return undefined;
  return new Date(unixMs as number).toISOString();
}

function expiryTitle(unixMs: number | undefined): string | undefined {
  const iso = isoTimestamp(unixMs);
  return iso ? `Auto-expires at ${iso}` : undefined;
}

function cn(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function brandingToStyle(b: Branding | undefined, override: CSSProperties | undefined): CSSProperties {
  if (!b) return override ?? {};
  const cssVars: Record<string, string> = {};
  if (b.primaryColor) cssVars['--psx-primary'] = b.primaryColor;
  if (b.accentColor) cssVars['--psx-accent'] = b.accentColor;
  if (b.radius) cssVars['--psx-radius'] = b.radius;
  if (b.fontFamily) cssVars['--psx-font'] = b.fontFamily;
  return { ...cssVars, ...override } as CSSProperties;
}
