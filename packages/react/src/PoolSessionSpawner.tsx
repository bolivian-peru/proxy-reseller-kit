'use client';

import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type {
  Country,
  Pool,
  Protocol,
  RotationMode,
  CarrierStockEntry,
  Branding,
  PoolPortalClassNames,
} from './types';

/**
 * Mode for the `-sid-` token across spawned URLs.
 *
 * - `unique`: each spawned URL gets a different sid (`<prefix><index>`),
 *   so each one creates its OWN gateway session and pins to its OWN
 *   IP. Use when you want N parallel proxies that don't share an IP.
 * - `same`: all spawned URLs share a single sid. They all hit the
 *   SAME gateway session and SAME IP. Use for sticky-IP workflows
 *   that distribute work across multiple consumers.
 * - `none`: per-row sid (same wire format as `unique`) but treated as
 *   throwaway by the caller — used when you don't want long-lived
 *   stickiness but still need N distinct URLs (the spawner never emits
 *   identical strings; 4 identical rows is a UX bug, not a feature).
 *
 * @public
 */
export type SessionType = 'unique' | 'same' | 'none';

/**
 * Props for {@link PoolSessionSpawner}.
 *
 * @public
 */
export interface PoolSessionSpawnerProps {
  /** Reseller's `proxyUsername` (e.g. `psx_abc123`). */
  proxyUsername: string;
  /**
   * The customer's password for proxy auth. Either a `pak_` key (preferred,
   * minted via `client.poolKeys.create()`) or the user's proxy-password.
   * The component holds this in component state only — never logs it.
   */
  proxyPassword: string;
  /** Available countries the user can choose. Defaults to the current Pool Gateway list. */
  countries?: readonly Country[];
  /**
   * Live carrier/ASN stock for the selected country (peer pool), e.g. from
   * `usePoolCarrierStock(apiRoute, country).data?.carriers`. When provided and
   * the pool is `peer`, a Carrier select appears and the chosen ASN is routed
   * as a hard `-asn-` filter. Counts only — never IPs.
   * @since 0.8.0
   */
  carrierStock?: CarrierStockEntry[];
  /** Default country selected on mount. */
  defaultCountry?: Country;
  /** Default pool selected on mount. */
  defaultPool?: Pool;
  /** Default protocol selected on mount. */
  defaultProtocol?: Protocol;
  /** Default rotation mode selected on mount. */
  defaultRotation?: RotationMode;
  /** Default sid mode selected on mount. */
  defaultSessionType?: SessionType;
  /** Maximum number of URLs the spawner can generate at once. Default 100. */
  maxCount?: number;
  /**
   * Show the "Session TTL override" advanced field. When the user sets a
   * value, it appends `-ttl-<seconds>` to the username DSL — gateway
   * accepts 60–86400 (1 min – 24 h) and clamps to [60, 86400] server-side.
   * Default true (reseller dashboards usually want it visible).
   * @since 0.4.2
   */
  showTtlControl?: boolean;
  /** Gateway hostname override (for edge deployments). Default `gw.proxies.sx`. */
  gatewayHost?: string;
  /**
   * Called every time the user clicks "Generate". Receives the
   * generated URLs as an array. The component already copies them
   * to clipboard by default — use this to log analytics, persist a
   * "last generation" record, etc.
   */
  onSpawn?: (urls: string[], meta: SpawnMeta) => void;
  /** Branding for CSS custom properties (`--psx-primary`, etc.). */
  branding?: Branding;
  /** Per-part className overrides for Tailwind / custom CSS. */
  classNames?: PoolPortalClassNames;
  /** Extra class on the root element. */
  className?: string;
  /** Inline style override on the root. */
  style?: CSSProperties;
  /** Optional empty-state slot when proxy creds are missing. */
  emptyState?: ReactNode;
}

/**
 * Metadata about a generation, passed to `onSpawn`.
 * @public
 */
export interface SpawnMeta {
  count: number;
  country: Country;
  pool: Pool;
  protocol: Protocol;
  rotation: RotationMode;
  sessionType: SessionType;
  /** Random prefix used to make sids unique-per-generation. */
  sessionPrefix: string;
  generatedAt: number;
}

/* ── Constants ────────────────────────────────────────────────────────── */

const DEFAULT_COUNTRIES: readonly Country[] = ['us', 'de', 'gb', 'es', 'fr', 'pl'];

const COUNTRY_LABELS: Record<string, { name: string; flag: string }> = {
  us: { name: 'United States', flag: '\u{1F1FA}\u{1F1F8}' },
  de: { name: 'Germany', flag: '\u{1F1E9}\u{1F1EA}' },
  gb: { name: 'United Kingdom', flag: '\u{1F1EC}\u{1F1E7}' },
  es: { name: 'Spain', flag: '\u{1F1EA}\u{1F1F8}' },
  fr: { name: 'France', flag: '\u{1F1EB}\u{1F1F7}' },
  pl: { name: 'Poland', flag: '\u{1F1F5}\u{1F1F1}' },
};

const ROTATION_OPTS: { value: RotationMode; label: string }[] = [
  { value: 'none', label: 'Default (10 min)' },
  { value: 'auto10', label: '10 minutes' },
  // Sticky pins the modem AND the gateway smart-picks the most IP-stable
  // modem in the country (carrier-CGNAT-aware selection, May 2026).
  { value: 'sticky', label: 'Sticky (pin to most IP-stable modem)' },
  // Strict additionally applies a min-stability floor; best on the peer pool
  // (community SDK network), where home/ISP IPs hold for hours.
  { value: 'sticky-strict', label: 'Sticky-strict (best IP hold — pair with the peer pool)' },
  // `hard` pins like sticky at routing time — NOT a new modem per request.
  { value: 'hard', label: 'Hard (pins like sticky)' },
];

/* ── Helpers ──────────────────────────────────────────────────────────── */

function randomPrefix(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * Build a single proxy URL. Same DSL as `client.proxies.sx/pool-proxy`.
 *
 * The credentials half (`username:password`) is URL-encoded, so user-
 * supplied sids with `@` / `:` / `/` survive into the username portion
 * intact.
 *
 * `ttlSeconds` (when supplied) appends `-ttl-N` to the username — the
 * gateway accepts 60–86400 and clamps out-of-range values server-side.
 *
 * @public
 */
/**
 * Slugify a free-text value (carrier name) into a DSL-safe token.
 * The gateway lowercases the whole username, splits on `-`, then per token keeps
 * only `[a-z0-9_]` (max 64). So the value must contain no `-`, spaces, or
 * punctuation. Multi-word values collapse to a single token (e.g.
 * "New York" -> "newyork", "T-Mobile US" -> "tmobileus").
 */
export function slugifyDsl(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 64);
}

export function buildProxyString(opts: {
  proxyUsername: string;
  proxyPassword: string;
  pool: Pool;
  country: Country;
  protocol: Protocol;
  rotation: RotationMode;
  sessionType: SessionType;
  sessionPrefix: string;
  index: number;
  gatewayHost?: string;
  /** Optional session TTL override in seconds (60–86400). @since 0.4.2 */
  ttlSeconds?: number;
  /** Hard ASN filter (peer pool) — exact match, e.g. 21928 (T-Mobile). @since 0.8.0 */
  asn?: number;
  /** Soft carrier-name match (mbl / any pool) — e.g. "T-Mobile US". @since 0.9.0 */
  carrierName?: string;
}): string {
  const port = opts.protocol === 'http' ? 7000 : 7001;
  const tokens = [opts.pool, opts.country];
  // Carrier/ISP targeting differs by pool: the peer pool pins by exact ASN
  // (`-asn-<n>`); the mbl/any pool matches by carrier name (`-carrier-<slug>`).
  // Never emit -asn- on mbl — it can filter modem stock to zero.
  if (opts.asn) tokens.push('asn', String(opts.asn));
  else if (opts.carrierName) tokens.push('carrier', slugifyDsl(opts.carrierName));
  // Always inject a sid when spawning a multi-row table. 'same' shares one;
  // 'unique' and 'none' both give per-row sids — the only difference is that
  // 'none' callers don't want long-lived stickiness, but the URLs must still be
  // distinct or the spawner is useless (4 identical strings is a UX bug).
  // The gateway will still synthesize a fresh internal session when needed.
  if (opts.sessionType === 'same') tokens.push('sid', opts.sessionPrefix);
  else tokens.push('sid', `${opts.sessionPrefix}${opts.index}`);
  if (opts.rotation !== 'none' && opts.rotation !== 'auto10') {
    tokens.push('rot', opts.rotation);
  }
  if (opts.ttlSeconds && opts.ttlSeconds >= 60 && opts.ttlSeconds <= 86_400) {
    tokens.push('ttl', String(opts.ttlSeconds));
  }
  const username = `${opts.proxyUsername}-${tokens.join('-')}`;
  const host = opts.gatewayHost ?? 'gw.proxies.sx';
  return `${opts.protocol}://${encodeURIComponent(username)}:${encodeURIComponent(opts.proxyPassword)}@${host}:${port}`;
}

/**
 * Default session TTL for a given rotation mode (matches the gateway's
 * `ROTATION_INTERVALS` table). Useful for showing "this session lasts X"
 * in UIs where the user picks a rotation but doesn't override TTL.
 *
 * @public
 */
export function defaultTtlSecondsForRotation(rotation: RotationMode): number {
  switch (rotation) {
    case 'auto5': return 300;
    case 'auto10': return 600;
    case 'auto20': return 1200;
    case 'auto60': return 3600;
    case 'sticky': return 3600;
    case 'hard': return 0;       // per-connection, no reuse
    case 'none': return 3600;    // 1 h default at the gateway
    default: return 3600;
  }
}

/* ── Component ────────────────────────────────────────────────────────── */

/**
 * Multi-port spawner — generate N proxy URLs in one click with full
 * country / pool / rotation / sid-mode controls. Mirrors the
 * `client.proxies.sx/pool-proxy` UX; drop-in for resellers who want
 * customer-facing parity for free.
 *
 * The proxyPassword you pass in (a `pak_` key or proxy-password) is
 * embedded directly in the generated URLs — it never leaves the user's
 * browser unless they paste a URL somewhere themselves.
 *
 * @example
 * ```tsx
 * <PoolSessionSpawner
 *   proxyUsername={me.proxyUsername}
 *   proxyPassword={me.pakKey}
 *   defaultPool="mbl"
 *   onSpawn={(urls) => analytics.track('proxy_spawn', { count: urls.length })}
 * />
 * ```
 *
 * @public
 */
export function PoolSessionSpawner(props: PoolSessionSpawnerProps): JSX.Element {
  const {
    proxyUsername,
    proxyPassword,
    countries = DEFAULT_COUNTRIES,
    carrierStock = [],
    defaultCountry = countries[0]!,
    defaultPool = 'mbl',
    defaultProtocol = 'http',
    defaultRotation = 'none',
    defaultSessionType = 'unique',
    maxCount = 100,
    showTtlControl = true,
    gatewayHost,
    onSpawn,
    branding,
    classNames = {},
    className,
    style,
    emptyState,
  } = props;

  const [count, setCount] = useState(5);
  const [country, setCountry] = useState<Country>(defaultCountry);
  const [pool, setPool] = useState<Pool>(defaultPool);
  // Carrier/ASN selection — peer pool only. 0 = any carrier. Reset when the
  // scope (country/pool) changes, since a carrier in one country doesn't apply
  // to another. Live stock is supplied by the host via the `carrierStock` prop
  // (see the `usePoolCarrierStock` hook).
  const [carrierAsn, setCarrierAsn] = useState<number>(0);
  useEffect(() => {
    setCarrierAsn(0);
  }, [country, pool]);
  const [protocol, setProtocol] = useState<Protocol>(defaultProtocol);
  const [rotation, setRotation] = useState<RotationMode>(defaultRotation);
  const [sessionType, setSessionType] = useState<SessionType>(defaultSessionType);
  const [sessionPrefix] = useState(() => randomPrefix());
  const [generated, setGenerated] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  // TTL override. Empty string = use default-for-rotation. The gateway
  // clamps to [60, 86400] regardless of what we send.
  const [ttlSecondsRaw, setTtlSecondsRaw] = useState<string>('');
  const ttlSeconds = useMemo(() => {
    if (!ttlSecondsRaw.trim()) return undefined;
    const n = Number(ttlSecondsRaw);
    if (!Number.isFinite(n)) return undefined;
    return Math.max(60, Math.min(86_400, Math.round(n)));
  }, [ttlSecondsRaw]);
  const effectiveTtl = ttlSeconds ?? defaultTtlSecondsForRotation(rotation);

  const rootStyle = useMemo<CSSProperties>(() => brandingToStyle(branding, style), [branding, style]);

  const handleGenerate = useCallback(() => {
    if (!proxyUsername || !proxyPassword) return;
    const urls: string[] = [];
    for (let i = 1; i <= count; i++) {
      urls.push(
        buildProxyString({
          proxyUsername, proxyPassword, pool, country, protocol, rotation,
          sessionType, sessionPrefix, index: i, gatewayHost,
          ttlSeconds,
          // peer pool pins by exact ASN; mbl/any matches by carrier name.
          asn: pool === 'peer' && carrierAsn ? carrierAsn : undefined,
          carrierName:
            pool !== 'peer' && carrierAsn
              ? carrierStock.find((c) => c.asn === carrierAsn)?.name
              : undefined,
        }),
      );
    }
    setGenerated(urls);
    void navigator.clipboard?.writeText(urls.join('\n'));
    onSpawn?.(urls, {
      count, country, pool, protocol, rotation, sessionType, sessionPrefix,
      generatedAt: Date.now(),
    });
  }, [proxyUsername, proxyPassword, count, country, pool, carrierAsn, carrierStock, protocol, rotation, sessionType, sessionPrefix, gatewayHost, ttlSeconds, onSpawn]);

  const handleCopyOne = useCallback((url: string, idx: number) => {
    void navigator.clipboard?.writeText(url);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex((p) => (p === idx ? null : p)), 1500);
  }, []);

  const handleDownload = useCallback(() => {
    if (!generated.length) return;
    const blob = new Blob([generated.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proxies-${country}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generated, country]);

  if (!proxyUsername || !proxyPassword) {
    return (
      <div className={cn('psx', 'psx-spawner-empty', classNames.root, className)} style={rootStyle}>
        {emptyState ?? (
          <p>Configure your proxy username and password to generate proxy URLs.</p>
        )}
      </div>
    );
  }

  return (
    <div className={cn('psx', 'psx-spawner', classNames.root, className)} style={rootStyle}>
      <div className={cn('psx-spawner-controls', classNames.card)}>
        {/* Count */}
        <label className="psx-spawner-row">
          <span>Count</span>
          <input
            type="number"
            min={1}
            max={maxCount}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(maxCount, Number(e.target.value) || 1)))}
            className={cn('psx-input', classNames.input)}
          />
          <span className="psx-spawner-hint">1–{maxCount}</span>
        </label>

        {/* Country */}
        <label className="psx-spawner-row">
          <span>Country</span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value as Country)}
            className={cn('psx-select', classNames.select)}
          >
            {countries.map((c) => {
              const meta = COUNTRY_LABELS[c.toLowerCase()] ?? { name: c.toUpperCase(), flag: '🌐' };
              return <option key={c} value={c}>{meta.flag} {meta.name}</option>;
            })}
          </select>
        </label>

        {/* Pool */}
        <label className="psx-spawner-row">
          <span>Pool</span>
          <select
            value={pool}
            onChange={(e) => setPool(e.target.value as Pool)}
            className={cn('psx-select', classNames.select)}
          >
            <option value="mbl">Mobile — production modems</option>
            <option value="peer">Peer network — community (mobile + residential)</option>
            <option value="any">Any — best available</option>
          </select>
        </label>

        {/* Carrier / ISP — shown for ANY pool that has live carrier stock.
            peer pool routes the choice as a hard `-asn-<n>` filter; mbl / any
            route it as a soft `-carrier-<name>` match. Live stock supplied by
            the host via the `carrierStock` prop (see `usePoolCarrierStock`).
            Counts only — never IPs. */}
        {carrierStock.length > 0 && (
          <label className="psx-spawner-row">
            <span>Carrier / ISP</span>
            <select
              value={String(carrierAsn)}
              onChange={(e) => setCarrierAsn(Number(e.target.value) || 0)}
              className={cn('psx-select', classNames.select)}
            >
              <option value="0">Any carrier</option>
              {carrierStock
                .filter((c) => c.asn != null)
                .map((c) => (
                  <option key={c.asn!} value={String(c.asn)}>
                    {c.name} ({c.ipType}) — {c.count}
                  </option>
                ))}
            </select>
          </label>
        )}

        {/* Protocol */}
        <label className="psx-spawner-row">
          <span>Protocol</span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as Protocol)}
            className={cn('psx-select', classNames.select)}
          >
            <option value="http">HTTP (port 7000)</option>
            <option value="socks5">SOCKS5 (port 7001)</option>
          </select>
        </label>

        {/* Rotation */}
        <label className="psx-spawner-row">
          <span>Rotation</span>
          <select
            value={rotation}
            onChange={(e) => setRotation(e.target.value as RotationMode)}
            className={cn('psx-select', classNames.select)}
          >
            {ROTATION_OPTS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>

        {/* Session-id mode */}
        <label className="psx-spawner-row">
          <span>Session id</span>
          <select
            value={sessionType}
            onChange={(e) => setSessionType(e.target.value as SessionType)}
            className={cn('psx-select', classNames.select)}
          >
            <option value="unique">Unique per row (each gets its own IP)</option>
            <option value="same">Same sid (all share one IP)</option>
            <option value="none">Throwaway per row (distinct URLs, short-lived)</option>
          </select>
        </label>

        <button
          type="button"
          onClick={handleGenerate}
          className={cn('psx-button', 'psx-spawner-generate', classNames.button)}
        >
          Generate {count} proxy URL{count > 1 ? 's' : ''}
        </button>
      </div>

      {generated.length > 0 && (
        <div className={cn('psx-spawner-output', classNames.card)}>
          <div className="psx-spawner-output-header">
            <span>{generated.length} proxies generated</span>
            <div className="psx-spawner-output-actions">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(generated.join('\n'));
                }}
                className={cn('psx-button', classNames.button)}
              >
                Copy all
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className={cn('psx-button', classNames.button)}
              >
                Download .txt
              </button>
            </div>
          </div>
          <ol className="psx-spawner-list">
            {generated.map((url, i) => (
              <li key={i}>
                <code className="psx-spawner-url">{url}</code>
                <button
                  type="button"
                  onClick={() => handleCopyOne(url, i)}
                  className={cn('psx-button', 'psx-button-ghost', classNames.button)}
                  aria-label={`Copy proxy ${i + 1}`}
                >
                  {copiedIndex === i ? 'Copied' : 'Copy'}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/* ── Internal helpers ─────────────────────────────────────────────────── */

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
