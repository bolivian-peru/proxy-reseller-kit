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
  PoolStock,
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
 * Failover scope — when the selected exit is unavailable (or drops on connect),
 * where the gateway re-picks a replacement. Emitted as the `-failover-<v>`
 * username token. `samecountry` is the gateway default, so it is only emitted
 * when overridden. Mirrors `client.proxies.sx/pool-proxy`.
 *
 * @public
 */
export type FailoverPolicy = 'any' | 'samecountry' | 'samecarrier' | 'samenode' | 'strict';

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
   * Live per-country stock, e.g. from `usePoolStock(apiRoute).data`. When
   * provided, the country picker gains a **stock-depth signal**: each option
   * carries its routable count and depth tier, and the selected country shows
   * a coloured tier dot plus a warning when the pool is thin.
   *
   * This matters because a bare count is not decision-grade — "2" and "244"
   * read identically as small grey numbers, so a customer picking a
   * two-endpoint country gets no warning that there is nothing to fail over
   * to. Counts only — never exit IPs.
   *
   * Omit it and the picker renders exactly as before.
   * @since 0.12.0
   */
  stock?: PoolStock;
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
  /** Default failover scope selected on mount. Default `samecountry`. @since 0.10.0 */
  defaultFailover?: FailoverPolicy;
  /** Maximum number of URLs the spawner can generate at once. Default 100. */
  maxCount?: number;
  /**
   * Show the "Session lifetime" field (1 h / 8 h / 24 h / 7 d / 30 d presets).
   * Anything above the gateway default appends `-ttl-<seconds>` to the
   * username DSL — the gateway accepts 60–2,592,000 s and clamps server-side.
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
  failover: FailoverPolicy;
  /** Random prefix used to make sids unique-per-generation. */
  sessionPrefix: string;
  generatedAt: number;
}

/* ── Constants ────────────────────────────────────────────────────────── */

const DEFAULT_COUNTRIES: readonly Country[] = ['us', 'gb', 'fr', 'nl', 'pl', 'ge'];

// Country names/flags are DERIVED, not tabulated: the peer pool spans ~82
// countries, so a hardcoded six-entry map left every other country a bare
// 2-letter code. `Intl.DisplayNames` resolves them all in the browser and the
// flag is a pure code-point transform of the ISO code.
const REGION_NAMES = ((): Intl.DisplayNames | null => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

function countryName(code: Country): string {
  const cc = String(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return cc;
  try {
    return REGION_NAMES?.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

function countryFlag(code: Country): string {
  const cc = String(code).toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '\u{1F310}';
  return String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

const ROTATION_OPTS: { value: RotationMode; label: string }[] = [
  { value: 'none', label: 'Default (10 min)' },
  { value: 'auto5', label: '5 minutes' },
  { value: 'auto10', label: '10 minutes' },
  { value: 'auto20', label: '20 minutes' },
  { value: 'auto60', label: '60 minutes' },
  // No rotation timer: the endpoint is kept while the connection lives and a
  // NEW connection re-picks. The gateway has always accepted this token; the
  // spawner just never offered it.
  { value: 'ondemand', label: 'On demand (re-pick per connection)' },
  // Sticky pins the modem AND the gateway smart-picks the most IP-stable
  // modem in the country (carrier-CGNAT-aware selection, May 2026). For a
  // near-immutable IP, pair with the peer pool — home/ISP IPs hold for hours.
  { value: 'sticky', label: 'Sticky (pin to most IP-stable modem)' },
  // `hard` pins like sticky at routing time — NOT a new modem per request.
  { value: 'hard', label: 'Hard (pins like sticky)' },
];

// Per-mode one-liner shown under the picker. These replace hover tooltips on
// purpose: a `title` attribute is invisible on touch, which is where a good
// share of a reseller's customers configure their proxies.
const ROTATION_HINTS: Record<RotationMode, string> = {
  none: 'No -rot- token is emitted, so the gateway default applies: a different endpoint about every 10 minutes.',
  auto5: 'Re-picks a different endpoint every 5 minutes.',
  auto10: 'Re-picks a different endpoint every 10 minutes (same as the gateway default).',
  auto20: 'Re-picks a different endpoint every 20 minutes.',
  auto60: 'Re-picks a different endpoint every 60 minutes.',
  ondemand: 'No rotation timer — the endpoint is held for as long as the connection lives, and each NEW connection re-picks.',
  sticky:
    'Pins one endpoint for the session and prefers the most IP-stable one available. It pins the MODEM, not the IP — mobile carrier CGNAT can still re-NAT the exit. For an IP that holds for hours, use the peer pool (home / ISP IPs).',
  hard:
    'Pins exactly like sticky at routing time — NOT a fresh IP per request. A real carrier-IP reset only happens through the explicit rotate action, which peers do not support.',
};

// Failover scope options + honest one-liners. Mirrors the failover picker on
// client.proxies.sx/pool-proxy. `samecountry` is the gateway default.
const FAILOVER_OPTS: { value: FailoverPolicy; label: string }[] = [
  { value: 'samecountry', label: 'Same country (recommended)' },
  { value: 'samecarrier', label: 'Same carrier' },
  { value: 'samenode', label: 'Same relay node' },
  { value: 'any', label: 'Any available' },
  { value: 'strict', label: 'No failover (fail clean)' },
];

const FAILOVER_HINTS: Record<FailoverPolicy, string> = {
  samecountry: 'If the exit drops, retry on another exit in the SAME country. Best for geo-locked work.',
  samecarrier: 'Only fail over within the same carrier — tightest match, fewest fallbacks.',
  samenode: 'Stay on the same relay node. Lowest latency on retry.',
  any: 'Fail over to any available exit, even in another country. Maximum uptime, geo may change.',
  strict:
    'Never substitute — if the pinned exit is gone the request fails instead of silently moving. (This is the failover SCOPE named "strict"; it is not the sticky stability floor below.)',
};

// '' = no `-iptype-` token at all. The mbl pool is mobile by construction, so
// this control is only rendered for peer / any.
const IP_TYPE_HINTS: Record<string, string> = {
  '': 'No class filter — routes on every verified and unclassified endpoint (the largest pool).',
  mobile:
    'Hard filter: only endpoints verified as cellular-carrier IPs. Mobile depth is thinner than residential — check the country count above before committing.',
  residential:
    'Hard filter: only home / ISP IPs. These hold an exit IP far longer than mobile does, so this is the pairing for sticky held-IP workflows.',
  datacenter:
    'Hard filter: only hosting IPs. Very few peers are datacenter, so expect thin stock in most countries.',
};

const SESSION_HINTS: Record<SessionType, string> = {
  unique: 'Each row gets its own -sid-, so every URL is a separate gateway session on its own endpoint.',
  same: 'All rows share one -sid-: they land on the SAME session and the same endpoint, so N consumers share one IP.',
  none: 'Per-row throwaway -sid-s — N distinct short-lived sessions. Fan-out without keeping the IPs afterwards.',
};

/**
 * Session-row TTL presets. The gateway accepts 60–2,592,000 s; 3600 is its
 * default, so picking "1 hour" emits no token at all.
 */
const DEFAULT_TTL_SECONDS = 3600;

const TTL_PRESETS: { value: number; label: string }[] = [
  { value: DEFAULT_TTL_SECONDS, label: '1 hour (default)' },
  { value: 28_800, label: '8 hours' },
  { value: 86_400, label: '24 hours' },
  { value: 604_800, label: '7 days' },
  { value: 2_592_000, label: '30 days (max)' },
];

/* ── Stock depth ──────────────────────────────────────────────────────── */

/**
 * How much routable stock a country has for the selected pool.
 *
 * Thresholds differ per pool because the pools differ: 15 carrier modems is a
 * genuinely well-stocked country, while 15 peers is thin — peers churn. Same
 * bands as the `client.proxies.sx` country picker, so a reseller's customer
 * sees the same verdict our own customers see.
 *
 * @public
 */
export type StockDepth = 'strong' | 'limited' | 'thin' | 'none';

const DEPTH_LABELS: Record<StockDepth, string> = {
  strong: 'Strong',
  limited: 'Limited',
  thin: 'Thin',
  none: 'None',
};

export function stockDepthFor(routable: number, pool: Pool): StockDepth {
  const n = Math.max(0, Math.floor(routable || 0));
  if (n === 0) return 'none';
  if (pool === 'mbl') {
    if (n >= 15) return 'strong';
    if (n >= 5) return 'limited';
    return 'thin';
  }
  // peer / any / best
  if (n >= 50) return 'strong';
  if (n >= 10) return 'limited';
  return 'thin';
}

/**
 * Routable endpoints for one country in the selected pool, or `null` when the
 * caller passed no stock (in which case the whole depth signal stays hidden
 * rather than guessing).
 */
function routableCount(stock: PoolStock | undefined, country: Country, pool: Pool): number | null {
  if (!stock?.pools) return null;
  const cc = String(country).toLowerCase();
  const mbl = stock.pools.mbl?.[cc] ?? 0;
  const peer = stock.pools.peer?.[cc] ?? 0;
  if (pool === 'mbl') return mbl;
  if (pool === 'peer') return peer;
  return mbl + peer;
}

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
 * gateway accepts 60–2,592,000 and clamps out-of-range values server-side.
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
  /** Optional session TTL override in seconds (60–2,592,000). @since 0.4.2 */
  ttlSeconds?: number;
  /** Hard ASN filter (peer pool) — exact match, e.g. 21928 (T-Mobile). @since 0.8.0 */
  asn?: number;
  /** Soft carrier-name match (mbl / any pool) — e.g. "T-Mobile US". @since 0.9.0 */
  carrierName?: string;
  /**
   * Failover scope. Emits `-failover-<v>` only when overriding the gateway
   * default (`samecountry`). @since 0.10.0
   */
  failover?: FailoverPolicy;
  /**
   * Hard IP-class filter (peer/any pools). `mobile` = cellular-carrier exit
   * IPs, `residential` = home/ISP IPs, `datacenter` = hosting IPs. Emits
   * `-iptype-<v>`; the endpoint must be that verified class (unclassified
   * peers are excluded). The mbl pool is mobile by construction, so this is
   * only meaningful for peer/any. @since 0.11.0
   */
  ipType?: 'mobile' | 'residential' | 'datacenter';
  /**
   * Strict stability floor for pinned sessions — the bare `strict` token
   * (no value). The gateway only honors it when rotation is `sticky` or
   * `hard`; there it excludes endpoints below an IP-stability score of 40 and
   * weights stability at 0.7 of the selection score. Mirrors
   * `BuildProxyUrlOpts.strict` in `@proxies-sx/pool-sdk`. @since 0.12.0
   */
  strict?: boolean;
}): string {
  const port = opts.protocol === 'http' ? 7000 : 7001;
  const tokens = [opts.pool, opts.country];
  // Carrier/ISP targeting differs by pool: the peer pool pins by exact ASN
  // (`-asn-<n>`); the mbl/any pool matches by carrier name (`-carrier-<slug>`).
  // Never emit -asn- on mbl — it can filter modem stock to zero.
  if (opts.asn) tokens.push('asn', String(opts.asn));
  else if (opts.carrierName) tokens.push('carrier', slugifyDsl(opts.carrierName));
  // Hard IP-class filter. Meaningful for peer/any; a no-op on mbl (which is
  // mobile by construction), so we only emit it when the pool isn't mbl.
  if (opts.ipType && opts.pool !== 'mbl') tokens.push('iptype', opts.ipType);
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
  // Bare `strict` flag — no value, the parser consumes a single part. The
  // gateway selector only reads it when the rotation is sticky or hard
  // (`strictSticky = stickyMode and ARGV[16] == '1'`), so emitting it for a
  // rotating mode is inert noise in the credential. Only emit where it acts.
  if (opts.strict && (opts.rotation === 'sticky' || opts.rotation === 'hard')) {
    tokens.push('strict');
  }
  // samecountry is the gateway default — only emit -failover- when overriding.
  if (opts.failover && opts.failover !== 'samecountry') {
    tokens.push('failover', opts.failover);
  }
  if (opts.ttlSeconds && opts.ttlSeconds >= 60 && opts.ttlSeconds <= 2_592_000) {
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
    // No rotation timer at all, so the row simply lives for the gateway default.
    case 'ondemand': return 3600;
    case 'sticky': return 3600;
    // `hard` pins exactly like `sticky` at routing time — it is NOT
    // per-connection and NOT a fresh IP per request. A real carrier-IP reset
    // only happens via the explicit /rotate action.
    case 'hard': return 3600;
    // `none` emits no -rot- token, so the gateway applies auto10. The session
    // ROW still lives for the gateway's 3600 s default; that is a row TTL, not
    // a promise that the exit IP holds for an hour.
    case 'none': return 3600;
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
    stock,
    defaultCountry = countries[0]!,
    defaultPool = 'mbl',
    defaultProtocol = 'http',
    defaultRotation = 'none',
    defaultSessionType = 'unique',
    defaultFailover = 'samecountry',
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
  // Hard IP-class filter — peer/any pools only ('' = any class). mbl is mobile
  // by construction, so we reset the filter whenever mbl is selected.
  const [ipType, setIpType] = useState<'' | 'mobile' | 'residential' | 'datacenter'>('');
  useEffect(() => {
    if (pool === 'mbl') setIpType('');
  }, [pool]);
  const [protocol, setProtocol] = useState<Protocol>(defaultProtocol);
  const [rotation, setRotation] = useState<RotationMode>(defaultRotation);
  // Strict stability floor — only meaningful (and only emitted) for the
  // pinning modes, so the control is hidden for the rotating ones. The choice
  // is kept in state while hidden so flipping back to sticky restores it.
  const [strict, setStrict] = useState(false);
  const [failover, setFailover] = useState<FailoverPolicy>(defaultFailover);
  const [sessionType, setSessionType] = useState<SessionType>(defaultSessionType);
  const [sessionPrefix] = useState(() => randomPrefix());
  const [generated, setGenerated] = useState<string[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  // Session-row lifetime. 3600 s is the gateway's own default, so that preset
  // emits no `-ttl-` token at all — same behaviour, cleaner credential.
  const [ttlPreset, setTtlPreset] = useState<number>(DEFAULT_TTL_SECONDS);
  const ttlSeconds = ttlPreset === DEFAULT_TTL_SECONDS ? undefined : ttlPreset;

  const isPinned = rotation === 'sticky' || rotation === 'hard';

  const rootStyle = useMemo<CSSProperties>(() => brandingToStyle(branding, style), [branding, style]);

  // Live stock-depth for the selected country + pool. `null` whenever the host
  // passed no `stock` prop — the whole signal then stays hidden rather than
  // asserting a depth we don't know.
  const routable = routableCount(stock, country, pool);
  const depth = routable === null ? null : stockDepthFor(routable, pool);

  const handleGenerate = useCallback(() => {
    if (!proxyUsername || !proxyPassword) return;
    const urls: string[] = [];
    for (let i = 1; i <= count; i++) {
      urls.push(
        buildProxyString({
          proxyUsername, proxyPassword, pool, country, protocol, rotation,
          sessionType, sessionPrefix, index: i, gatewayHost,
          ttlSeconds, failover,
          // peer pool pins by exact ASN; mbl/any matches by carrier name.
          asn: pool === 'peer' && carrierAsn ? carrierAsn : undefined,
          carrierName:
            pool !== 'peer' && carrierAsn
              ? carrierStock.find((c) => c.asn === carrierAsn)?.name
              : undefined,
          ipType: ipType || undefined,
          strict,
        }),
      );
    }
    setGenerated(urls);
    void navigator.clipboard?.writeText(urls.join('\n'));
    onSpawn?.(urls, {
      count, country, pool, protocol, rotation, sessionType, failover, sessionPrefix,
      generatedAt: Date.now(),
    });
  }, [proxyUsername, proxyPassword, count, country, pool, carrierAsn, carrierStock, protocol, rotation, strict, failover, sessionType, sessionPrefix, gatewayHost, ttlSeconds, ipType, onSpawn]);

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

        {/* Country + stock depth. Options are left in the caller's order: a
            select is scanned by name, so re-sorting it by depth would make a
            known country hard to find. The depth verdict rides ON each option
            instead, and the selected one is restated below in colour. */}
        <label className="psx-spawner-row psx-spawner-row-wide">
          <span>Country</span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value as Country)}
            className={cn('psx-select', classNames.select)}
          >
            {countries.map((c) => {
              const n = routableCount(stock, c, pool);
              const label = `${countryFlag(c)} ${countryName(c)}`;
              if (n === null) return <option key={c} value={c}>{label}</option>;
              return (
                <option key={c} value={c}>
                  {label} · {n} routable · {DEPTH_LABELS[stockDepthFor(n, pool)]}
                </option>
              );
            })}
          </select>
          {depth !== null && (
            <>
              <span className="psx-spawner-depth" data-depth={depth} aria-live="polite">
                <span className="psx-spawner-depth-dot" aria-hidden="true" />
                <span className="psx-spawner-depth-count">{routable}</span>
                <span>routable in {countryName(country)} now · {DEPTH_LABELS[depth]}</span>
              </span>
              {depth === 'none' && (
                <span className="psx-spawner-hint psx-spawner-hint-danger">
                  No routable endpoints here right now. These URLs would come back
                  502 <code>E_NO_STOCK_COUNTRY</code> — pick another country, or switch pool.
                </span>
              )}
              {(depth === 'thin' || depth === 'limited') && (
                <span className="psx-spawner-hint psx-spawner-hint-warn">
                  Thin stock: the gateway may reuse the same few exits, and there is
                  little to fail over to if one drops. A country marked Strong is steadier.
                </span>
              )}
              <span className="psx-spawner-legend">
                Stock depth for the selected pool — Strong: deep, failover has room ·
                Limited: few spares · Thin: little to fall back on. Counts are live
                routable endpoints, never IPs.
              </span>
            </>
          )}
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

        {/* IP class — hard mobile/residential/datacenter filter for the peer-
            backed pools. mbl is mobile by construction, so this only shows for
            peer/any. Emits `-iptype-<v>`; unclassified peers are excluded. */}
        {pool !== 'mbl' && (
          <label className="psx-spawner-row">
            <span>IP class</span>
            <select
              value={ipType}
              onChange={(e) => setIpType(e.target.value as typeof ipType)}
              className={cn('psx-select', classNames.select)}
            >
              <option value="">Any — mobile or residential</option>
              <option value="mobile">Mobile only — cellular-carrier IPs</option>
              <option value="residential">Residential only — home / ISP IPs</option>
              <option value="datacenter">Datacenter only — hosting IPs</option>
            </select>
            <span className="psx-spawner-hint">{IP_TYPE_HINTS[ipType]}</span>
          </label>
        )}

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
          <span className="psx-spawner-hint">{ROTATION_HINTS[rotation]}</span>
        </label>

        {/* Strict stability floor — a bare `strict` token the gateway only
            reads for the pinning modes, so it only exists as a control there.
            Its own row (not nested in the rotation label) because one <label>
            may only own one control. */}
        {isPinned && (
          <label className="psx-spawner-row psx-spawner-row-check">
            <span className="psx-spawner-check">
              <input
                type="checkbox"
                checked={strict}
                onChange={(e) => setStrict(e.target.checked)}
                className={cn('psx-checkbox', classNames.input)}
              />
              Strict stability floor
            </span>
            <span className="psx-spawner-hint">
              Only pin to endpoints with a proven IP-stability score, and weight
              stability above load when choosing. Fewer endpoints qualify, so
              expect thinner stock — worth it when the IP has to hold.
            </span>
          </label>
        )}

        {/* Failover — where the gateway re-picks when the exit drops. Mirrors
            the failover control on client.proxies.sx/pool-proxy. */}
        <label className="psx-spawner-row">
          <span>Failover</span>
          <select
            value={failover}
            onChange={(e) => setFailover(e.target.value as FailoverPolicy)}
            className={cn('psx-select', classNames.select)}
          >
            {FAILOVER_OPTS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <span className="psx-spawner-hint">
            {FAILOVER_HINTS[failover]} Auto-failover is always on — this only sets
            how wide the replacement may be.
          </span>
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
          <span className="psx-spawner-hint">
            {SESSION_HINTS[sessionType]} Every generated URL carries a <code>-sid-</code>,
            which is the token that makes sticky and auto-rotation persist across
            connections.
          </span>
        </label>

        {/* Session lifetime (`-ttl-`). Presets only: the gateway clamps to
            60–2,592,000 s anyway, and a free-text seconds box asks a customer
            to do arithmetic to express "a week". */}
        {showTtlControl && (
          <label className="psx-spawner-row psx-spawner-row-wide">
            <span>Session lifetime</span>
            <select
              value={String(ttlPreset)}
              onChange={(e) => setTtlPreset(Number(e.target.value))}
              className={cn('psx-select', classNames.select)}
            >
              {TTL_PRESETS.map((t) => (
                <option key={t.value} value={String(t.value)}>{t.label}</option>
              ))}
            </select>
            <span className="psx-spawner-hint">
              How long the gateway keeps the session row alive after the last
              request. Raise it to survive idle gaps — at the 1 hour default a
              sticky session left overnight is gone by morning and comes back on a
              different endpoint. It is a row lifetime, not a promise that the exit
              IP holds. TTL is fixed for the life of a session id: changing it
              affects NEW sids only, so generate again for it to take effect.
            </span>
          </label>
        )}

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
