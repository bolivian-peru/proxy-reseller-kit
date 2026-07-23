'use client';

import { type CSSProperties, type JSX } from 'react';
import { usePoolStock } from './hooks';
import type { Branding, PoolPortalClassNames } from './types';

/**
 * Props for {@link PoolStockGrid}.
 *
 * @public
 */
export interface PoolStockGridProps {
  /** Base path of your mounted `createPoolApiHandlers()`. Default `/api/pool`. */
  apiRoute?: string;
  /** Auto-refresh interval in ms. Default 30 000. */
  refreshIntervalMs?: number;
  /**
   * Restrict to specific countries. If omitted, every country present
   * in the live response renders, even ones we haven't seen before
   * (forward-compat with new countries the gateway adds).
   */
  countries?: readonly string[];
  /** Layout: `grid` (default, responsive cards) or `compact` (one-line per country). */
  variant?: 'grid' | 'compact';
  /** Whether to render the totals header. Default true. */
  showTotals?: boolean;
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
 * Live "country stock" widget — shows online endpoint counts per country
 * for both pools (`mbl` mobile + `peer` residential), plus pool-wide totals.
 *
 * Mirrors the live counter on `client.proxies.sx/pool-proxy`. Polls
 * `GET <apiRoute>/stock` every 30 s by default; counts update without
 * a page refresh.
 *
 * @example
 * ```tsx
 * <PoolStockGrid
 *   apiRoute="/api/pool"
 *   countries={['us', 'gb', 'fr', 'nl', 'pl', 'ge']}
 *   refreshIntervalMs={30_000}
 * />
 * ```
 *
 * @since 0.4.1
 * @public
 */
export function PoolStockGrid(props: PoolStockGridProps): JSX.Element {
  const {
    apiRoute = '/api/pool',
    refreshIntervalMs = 30_000,
    countries,
    variant = 'grid',
    showTotals = true,
    branding,
    classNames = {},
    className,
    style,
  } = props;

  const { data, loading, error } = usePoolStock(apiRoute, { refreshIntervalMs });

  if (loading && !data) {
    return (
      <div className={cn('psx', 'psx-stockgrid', classNames.root, className)} style={brandingToStyle(branding, style)}>
        <div className="psx-stockgrid-loading">Loading pool stock…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={cn('psx', 'psx-stockgrid', classNames.root, className)} style={brandingToStyle(branding, style)}>
        <div className="psx-stockgrid-error">Couldn't load stock — retrying.</div>
      </div>
    );
  }

  const mbl = data.pools?.mbl ?? {};
  const peer = data.pools?.peer ?? {};
  const totals = data.totals ?? { mbl: 0, peer: 0, all: 0 };

  // Union of country codes present in either pool, optionally filtered.
  const allCodes = new Set([...Object.keys(mbl), ...Object.keys(peer)]);
  const visible = countries
    ? countries.filter((c) => allCodes.has(c.toLowerCase()))
    : Array.from(allCodes).sort();

  return (
    <div className={cn('psx', 'psx-stockgrid', classNames.root, className)} style={brandingToStyle(branding, style)}>
      {showTotals && (
        <div className="psx-stockgrid-totals">
          <div className="psx-stockgrid-total-card">
            <div className="psx-stockgrid-total-num">{totals.all}</div>
            <div className="psx-stockgrid-total-label">endpoints online</div>
          </div>
          <div className="psx-stockgrid-total-card">
            <div className="psx-stockgrid-total-num">{totals.mbl}</div>
            <div className="psx-stockgrid-total-label">mobile (mbl)</div>
          </div>
          <div className="psx-stockgrid-total-card">
            <div className="psx-stockgrid-total-num">{totals.peer}</div>
            <div className="psx-stockgrid-total-label">residential (peer)</div>
          </div>
        </div>
      )}

      {variant === 'compact' ? (
        <ul className="psx-stockgrid-compact">
          {visible.map((c) => {
            const m = mbl[c] ?? 0;
            const p = peer[c] ?? 0;
            return (
              <li key={c}>
                <span className="psx-stockgrid-flag">{COUNTRY_FLAGS[c.toLowerCase()] ?? '🌐'}</span>
                <span className="psx-stockgrid-cc">{c.toUpperCase()}</span>
                <span className="psx-stockgrid-counts">
                  <span className="psx-stockgrid-mbl">{m} mbl</span>
                  {' · '}
                  <span className="psx-stockgrid-peer">{p} peer</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="psx-stockgrid-grid">
          {visible.map((c) => {
            const m = mbl[c] ?? 0;
            const p = peer[c] ?? 0;
            const total = m + p;
            const healthy = total >= 5;
            return (
              <div
                key={c}
                className="psx-stockgrid-card"
                data-healthy={healthy ? 'true' : 'false'}
                title={`${total} endpoints online in ${(COUNTRY_NAMES[c.toLowerCase()] ?? c.toUpperCase())}`}
              >
                <div className="psx-stockgrid-card-flag">{COUNTRY_FLAGS[c.toLowerCase()] ?? '🌐'}</div>
                <div className="psx-stockgrid-card-cc">{c.toUpperCase()}</div>
                <div className="psx-stockgrid-card-name">{COUNTRY_NAMES[c.toLowerCase()] ?? '—'}</div>
                <div className="psx-stockgrid-card-counts">
                  <div>
                    <span className="psx-stockgrid-card-num">{m}</span>
                    <span className="psx-stockgrid-card-pool">mbl</span>
                  </div>
                  <div>
                    <span className="psx-stockgrid-card-num">{p}</span>
                    <span className="psx-stockgrid-card-pool">peer</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="psx-stockgrid-help">
        Updated {data.generatedAt ? relTime(new Date(data.generatedAt).getTime()) : '—'}.
        Cached server-side for 30 s.
      </p>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const COUNTRY_FLAGS: Record<string, string> = {
  // mbl production countries
  us: '\u{1F1FA}\u{1F1F8}', gb: '\u{1F1EC}\u{1F1E7}', fr: '\u{1F1EB}\u{1F1F7}',
  nl: '\u{1F1F3}\u{1F1F1}', pl: '\u{1F1F5}\u{1F1F1}', ge: '\u{1F1EC}\u{1F1EA}',
  // peer-only examples
  de: '\u{1F1E9}\u{1F1EA}', es: '\u{1F1EA}\u{1F1F8}',
  ch: '\u{1F1E8}\u{1F1ED}', pa: '\u{1F1F5}\u{1F1E6}', am: '\u{1F1E6}\u{1F1F2}',
};

const COUNTRY_NAMES: Record<string, string> = {
  us: 'United States', gb: 'United Kingdom', fr: 'France',
  nl: 'Netherlands', pl: 'Poland', ge: 'Georgia',
  de: 'Germany', es: 'Spain',
  ch: 'Switzerland', pa: 'Panama', am: 'Armenia',
};

function relTime(unixMs: number): string {
  const diff = Date.now() - unixMs;
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return new Date(unixMs).toLocaleTimeString();
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
