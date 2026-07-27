'use client';

import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from 'react';
import { buildProxyUrl } from '@proxies-sx/pool-sdk';
import type {
  Branding,
  Country,
  MeResponse,
  Pool,
  PoolPortalClassNames,
  Protocol,
  RotationMode,
} from './types';
import {
  finiteOr,
  lowerCaseCountryKeys,
  useCopyToClipboard,
  useIncidents,
  usePoolKey,
  usePoolStock,
} from './hooks';

const DEFAULT_COUNTRIES: Country[] = ['us', 'gb', 'fr', 'nl', 'pl', 'ge'];

const ROTATION_OPTIONS: Array<{ value: RotationMode; label: string; hint: string }> = [
  // `none` sends no -rot- token, so the GATEWAY default applies: auto10.
  // It was labelled "Per-request / Fresh IP each request", which is the
  // opposite of what happens — one endpoint is held for up to 10 minutes.
  { value: 'none', label: 'Default', hint: 'Rotates ~every 10 min' },
  { value: 'auto10', label: 'Every 10 min', hint: 'Auto-rotate' },
  { value: 'auto20', label: 'Every 20 min', hint: 'Auto-rotate' },
  { value: 'sticky', label: 'Sticky session', hint: 'Same endpoint while active' },
];

export interface PoolPortalProps {
  /**
   * Base path on the host app where `createPoolApiHandlers()` is mounted.
   * The component calls `${apiRoute}/me`, `${apiRoute}/stock`, `${apiRoute}/incidents`.
   * @default "/api/pool"
   */
  apiRoute?: string;

  /** Countries the dropdown offers. Filter based on your market. */
  countries?: Country[];

  /**
   * Network the generated proxy URL routes through.
   *
   * - `mbl` — carrier modems. Exactly 6 countries: US, GB, FR, NL, PL, GE
   *   (Georgia, *not* Germany). Any other country has no `mbl` stock and the
   *   gateway returns `E_NO_STOCK_COUNTRY`.
   * - `peer` — the flagship network, mixed mobile + residential across
   *   ~82–120 countries. Use this whenever you widen `countries` beyond the
   *   six above.
   * - `best` / `any` — let the gateway pick.
   *
   * Defaults to `mbl` to preserve the behaviour of every existing embed.
   * Widening `countries` WITHOUT setting this builds e.g. `…-mbl-de-…`,
   * which always fails.
   *
   * @default "mbl"
   */
  pool?: Pool;

  /**
   * Whether to show the pool-stock indicator (dot + count per country).
   * @default true
   */
  showStock?: boolean;

  /** Whether to surface active incidents in a banner. @default true */
  showIncidents?: boolean;

  /** Whether to show the usage bar. @default true */
  showUsage?: boolean;

  /** Default protocol — can be toggled by the user. @default "http" */
  defaultProtocol?: Protocol;

  /** Default rotation policy. @default "none" */
  defaultRotation?: RotationMode;

  /** Default country. @default first in `countries` */
  defaultCountry?: Country;

  /** Brand overrides — applied as CSS custom properties. */
  branding?: Branding;

  /** Per-part className overrides (for Tailwind or custom CSS). */
  classNames?: PoolPortalClassNames;

  /** Extra class name on the root. */
  className?: string;

  /** Inline style on the root (useful for sizing). */
  style?: CSSProperties;

  /** Renders this when the user has no pak_ key yet (e.g. hasn't paid). */
  emptyState?: ReactNode;

  /** Called when the user clicks "Regenerate key" (optional — you handle the mutation server-side). */
  onRegenerateKey?: () => Promise<void> | void;
}

/**
 * Fallback for a `/api/pool/me` response that arrives without a `usage`
 * object. That route is implemented by the HOST app, so its shape is only as
 * reliable as their handler — and `usage.capGB` on `undefined` takes the
 * entire host tree down, not just this component. `enabled: true` is the
 * conservative default: showing a spurious "this key is disabled" banner is
 * worse than showing none.
 */
const EMPTY_USAGE: MeResponse['usage'] = {
  usedMB: 0,
  usedGB: 0,
  capGB: null,
  enabled: true,
  lastUsedAt: null,
};

const CLIPBOARD_BLOCKED =
  'Clipboard blocked by the browser — select the URL and copy it manually.';

const cx = (...parts: Array<string | undefined | false>) =>
  parts.filter(Boolean).join(' ');

/**
 * Drop-in reseller dashboard for the Proxies.sx Pool Gateway.
 *
 * All network access goes through the host app's `apiRoute` — the browser
 * never sees the reseller's `psx_` API key. Import the optional stylesheet
 * for default styling:
 *
 * ```ts
 * import '@proxies-sx/pool-portal-react/styles.css';
 * ```
 */
export function PoolPortal(props: PoolPortalProps): JSX.Element {
  const {
    apiRoute = '/api/pool',
    countries = DEFAULT_COUNTRIES,
    pool = 'mbl',
    showStock = true,
    showIncidents = true,
    showUsage = true,
    defaultProtocol = 'http',
    defaultRotation = 'none',
    defaultCountry,
    branding,
    classNames,
    className,
    style,
    emptyState,
    onRegenerateKey,
  } = props;

  const me = usePoolKey(apiRoute);
  const stock = usePoolStock(apiRoute, { refreshIntervalMs: showStock ? 30_000 : 0 });
  const incidents = useIncidents(apiRoute, {
    refreshIntervalMs: showIncidents ? 60_000 : 0,
  });

  const [country, setCountry] = useState<Country | undefined>(defaultCountry ?? countries[0]);
  const [rotation, setRotation] = useState<RotationMode>(defaultRotation);
  const [protocol, setProtocol] = useState<Protocol>(defaultProtocol);
  const [sid, setSid] = useState<string>('');
  const [copyError, setCopyError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Two portals can be mounted on one page (e.g. a compare view), so the
  // label/URL association must not use a hardcoded id.
  const urlLabelId = useId();

  const { copy, copied } = useCopyToClipboard();

  const proxyUrl = useMemo(() => {
    if (!me.data) return '';
    try {
      return buildProxyUrl(me.data.proxyUsername, me.data.pakKey, {
        country,
        pool,
        rotation,
        protocol,
        sid: sid || undefined,
        host: me.data.gatewayHost,
      });
    } catch {
      return '';
    }
  }, [me.data, country, pool, rotation, protocol, sid]);

  const rootStyle: CSSProperties = {
    ...styleFromBranding(branding),
    ...style,
  };

  /**
   * `useCopyToClipboard` resolves `false` when the write is refused — denied
   * permission, an insecure origin, a dismissed prompt. Reporting "Copied ✓"
   * in those cases sends the customer off to paste nothing, so surface it and
   * point them at the focusable URL instead.
   */
  async function handleCopy(): Promise<void> {
    if (!proxyUrl) return;
    const ok = await copy(proxyUrl);
    setCopyError(ok ? null : CLIPBOARD_BLOCKED);
  }

  /**
   * The host owns the mutation (and therefore the error reporting) — this only
   * tracks the in-flight state so the button can't be double-fired, and keeps a
   * rejection from surfacing as an unhandled promise in the host's app.
   */
  async function handleRegenerate(): Promise<void> {
    if (!onRegenerateKey) return;
    setRegenerating(true);
    try {
      await onRegenerateKey();
    } catch {
      /* host-reported */
    } finally {
      setRegenerating(false);
    }
  }

  // ---------- States ----------

  if (me.loading && !me.data) {
    return (
      <div
        className={cx('psx-pool-portal', 'psx-state-loading', classNames?.root, className)}
        style={rootStyle}
      >
        <div className={cx('psx-card', classNames?.card)}>
          <div className="psx-skeleton" style={{ height: 20, width: '50%' }} />
          <div className="psx-skeleton" style={{ height: 40, marginTop: 16 }} />
          <div className="psx-skeleton" style={{ height: 12, marginTop: 16 }} />
        </div>
      </div>
    );
  }

  if (me.error) {
    return (
      <div
        className={cx('psx-pool-portal', 'psx-state-error', classNames?.root, className)}
        style={rootStyle}
      >
        <div className={cx('psx-card', classNames?.card)}>
          <div className={cx('psx-banner', 'psx-banner-error', classNames?.banner)}>
            <strong>Couldn't load your proxy.</strong>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
              {me.error.message}
            </div>
            <button
              type="button"
              /* `refetch()` rejects on failure — it has already written the
                 error into `me.error`, so swallow it here rather than let it
                 become an unhandled rejection in the host app. */
              onClick={() => { me.refetch().catch(() => undefined); }}
              className={cx('psx-button', classNames?.button)}
              style={{ marginTop: 12 }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!me.data) {
    return (
      <div
        className={cx('psx-pool-portal', 'psx-state-empty', classNames?.root, className)}
        style={rootStyle}
      >
        <div className={cx('psx-card', classNames?.card)}>
          {emptyState ?? (
            <div className="psx-empty">
              <strong>No active proxy yet.</strong>
              <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                Purchase a plan to get your proxy credentials.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Everything below reads a body the host app produced. `usedGB`/`capGB` are
  // typed as numbers but arrive as JSON, so a string or a missing field would
  // render "NaN GB" and size the bar with an invalid `width: NaN%`.
  const usage = me.data.usage ?? EMPTY_USAGE;
  const usedGB = Number.isFinite(usage.usedGB) ? usage.usedGB : 0;
  const capGB =
    typeof usage.capGB === 'number' && Number.isFinite(usage.capGB) ? usage.capGB : null;
  const usagePct = capGB !== null && capGB > 0
    ? Math.min(100, (usedGB / capGB) * 100)
    : null;

  // `/incidents` is likewise host-mounted. A non-array body — the raw
  // `{ incidents, generatedAt }` envelope, an error object — must degrade to
  // "no banner", never to a crash on `.length`.
  const incident = Array.isArray(incidents.data) ? incidents.data[0] : undefined;

  // ---------- Main render ----------

  return (
    <div
      className={cx('psx-pool-portal', classNames?.root, className)}
      style={rootStyle}
      data-protocol={protocol}
    >
      {/* Incident banner */}
      {showIncidents && incident && (
        <div className={cx('psx-banner', 'psx-banner-warn', classNames?.banner)} role="status">
          <strong>{incident.title}</strong>
          {incident.description && (
            <div style={{ fontSize: 12, marginTop: 2 }}>{incident.description}</div>
          )}
        </div>
      )}

      <div className={cx('psx-card', classNames?.card)}>
        <div className={cx('psx-header', classNames?.header)}>
          {branding?.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.name ?? 'Logo'} className="psx-logo" />
          ) : (
            <div className="psx-header-title">{branding?.name ?? 'Pool Proxy'}</div>
          )}
          {showStock && stock.data && country && (
            <StockIndicator country={country} pool={pool} stock={stock.data} />
          )}
        </div>

        {/* Proxy URL */}
        <div className="psx-field">
          {/* Not a <label>: it labels a <code>, not a form control, so a real
              label would point at nothing. */}
          <span className="psx-label" id={urlLabelId}>Your proxy URL</span>
          <div className={cx('psx-url-row', classNames?.proxyUrl)}>
            {/* tabIndex makes the URL keyboard-reachable, which is the manual
                fallback the copy-failure message tells the customer to use. */}
            <code className="psx-url" tabIndex={0} aria-labelledby={urlLabelId}>{proxyUrl}</code>
            <button
              type="button"
              onClick={() => { void handleCopy(); }}
              disabled={!proxyUrl}
              className={cx('psx-button', 'psx-button-primary', classNames?.button)}
              aria-label="Copy proxy URL"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          {copyError && (
            <div
              className={cx('psx-banner', 'psx-banner-error', classNames?.banner)}
              style={{ marginTop: 8 }}
              role="status"
            >
              {copyError}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="psx-controls">
          <div className="psx-field">
            <label className="psx-label" htmlFor="psx-country">Country</label>
            <select
              id="psx-country"
              value={country ?? ''}
              onChange={(e) => setCountry((e.target.value || undefined) as Country | undefined)}
              className={cx('psx-select', classNames?.select)}
            >
              <option value="">Any</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="psx-field">
            <label className="psx-label" htmlFor="psx-rotation">Rotation</label>
            <select
              id="psx-rotation"
              value={rotation}
              onChange={(e) => setRotation(e.target.value as RotationMode)}
              className={cx('psx-select', classNames?.select)}
            >
              {ROTATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} title={o.hint}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="psx-field">
            <label className="psx-label" htmlFor="psx-protocol">Protocol</label>
            <select
              id="psx-protocol"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as Protocol)}
              className={cx('psx-select', classNames?.select)}
            >
              <option value="http">HTTP</option>
              <option value="socks5">SOCKS5</option>
            </select>
          </div>

          <div className="psx-field">
            {/* The placeholder used to be "my-session". validateSid() rejects a
                hyphen outright — its own error says so — because the gateway
                splits the username on `-`. The kit was suggesting the one value
                it refuses to build. */}
            <label className="psx-label" htmlFor="psx-sid">Session ID — required for sticky</label>
            <input
              id="psx-sid"
              type="text"
              placeholder="cust_8f3a21bd"
              value={sid}
              onChange={(e) => setSid(e.target.value)}
              className={cx('psx-input', classNames?.input)}
            />
          </div>
        </div>

        {/* Usage */}
        {showUsage && (
          <div className="psx-field psx-usage">
            <div className="psx-usage-header">
              <span className="psx-label">Usage</span>
              <span className="psx-usage-summary">
                {formatGB(usedGB)}
                {capGB !== null && ` / ${formatGB(capGB)}`}
              </span>
            </div>
            {usagePct !== null ? (
              <div
                className={cx('psx-usage-bar', classNames?.usageBar)}
                role="progressbar"
                aria-label="Traffic used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usagePct)}
                aria-valuetext={`${formatGB(usedGB)} of ${formatGB(capGB ?? 0)} used`}
              >
                <div
                  className="psx-usage-bar-fill"
                  style={{ width: `${usagePct}%` }}
                  data-level={levelForUsage(usagePct)}
                />
              </div>
            ) : (
              <div className="psx-usage-unlimited">Unlimited (within your plan)</div>
            )}
            {!usage.enabled && (
              <div className={cx('psx-banner', 'psx-banner-error')} style={{ marginTop: 8 }}>
                This key is <strong>disabled</strong>. Contact support to re-enable.
              </div>
            )}
            <ExpiryNotice
              expiresAt={usage.expiresAt}
              isExpired={usage.isExpired}
            />
          </div>
        )}

        {onRegenerateKey && (
          <div className="psx-actions">
            <button
              type="button"
              onClick={() => { void handleRegenerate(); }}
              disabled={regenerating}
              aria-busy={regenerating}
              className={cx('psx-button', 'psx-button-ghost', classNames?.button)}
            >
              {regenerating ? 'Regenerating…' : 'Regenerate key'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Renders a status banner about the customer's credit expiry.
 * - No expiry → renders nothing
 * - Expired → red banner with "renew" guidance
 * - ≤ 7 days → amber banner with countdown
 * - > 7 days → small dim line ("expires …")
 */
function ExpiryNotice({
  expiresAt,
  isExpired,
}: {
  expiresAt?: string | null;
  isExpired?: boolean;
}): JSX.Element | null {
  if (!expiresAt) return null;
  const expiryMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return null;

  const expired = isExpired ?? expiryMs <= Date.now();
  const days = Math.ceil((expiryMs - Date.now()) / 86_400_000);
  const formatted = new Date(expiresAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  if (expired) {
    return (
      <div className="psx-banner psx-banner-error" style={{ marginTop: 8 }}>
        Credits <strong>expired on {formatted}</strong>. Top up to reactivate the key.
      </div>
    );
  }
  if (days <= 7) {
    return (
      <div className="psx-banner psx-banner-warn" style={{ marginTop: 8 }}>
        Credits expire in <strong>{days} day{days === 1 ? '' : 's'}</strong> ({formatted}). Top up to extend.
      </div>
    );
  }
  return (
    <div className="psx-expiry-line" style={{ marginTop: 6, fontSize: 12, opacity: 0.7 }}>
      Expires {formatted} ({days} days remaining)
    </div>
  );
}

function StockIndicator({
  country,
  pool,
  stock,
}: {
  country: Country;
  /**
   * The pool the generated URL actually routes through. Counting both pools
   * told a customer on the default `mbl` that `de` had stock — peer stock they
   * cannot reach on that credential — and the connection then failed with
   * `E_NO_STOCK_COUNTRY`.
   */
  pool: Pool;
  /**
   * Live shape from `GET /v1/gateway/pool/stock`. Pre-0.3.1 the SDK
   * declared `{ countries: [...] }` which never matched the running
   * server — every dashboard rendered a blank stock indicator. Now
   * keyed by lowercase ISO country code (e.g. `'us'`).
   */
  stock: {
    pools: { mbl: Record<string, number>; peer: Record<string, number> };
  };
}): JSX.Element | null {
  // Same normalisation as `PoolStockGrid` — an upper-cased stock payload used
  // to make this badge disappear entirely instead of reporting the count.
  const cc = String(country).toLowerCase();
  const mblStock = lowerCaseCountryKeys(stock.pools?.mbl);
  const peerStock = lowerCaseCountryKeys(stock.pools?.peer);

  // Absent from BOTH pools means we have no reading for this country, not that
  // it is empty — render nothing rather than assert a zero we can't stand
  // behind. A real 0 in a country the payload DOES know about is shown: that's
  // the signal this pool/country pair is unroutable right now.
  if (!(cc in mblStock) && !(cc in peerStock)) return null;

  let online: number;
  switch (pool) {
    case 'mbl':
      online = finiteOr(mblStock[cc], 0);
      break;
    case 'peer':
      online = finiteOr(peerStock[cc], 0);
      break;
    default:
      // `any` / `best` — the gateway may serve from either pool.
      online = finiteOr(mblStock[cc], 0) + finiteOr(peerStock[cc], 0);
      break;
  }

  const label = `${online} live ${pool} endpoint${online === 1 ? '' : 's'} in ${cc.toUpperCase()}`;
  return (
    <div
      className="psx-stock"
      data-healthy={online >= 3}
      title={label}
      role="img"
      aria-label={label}
    >
      <span className="psx-stock-dot" />
      <span className="psx-stock-count">{online}</span>
    </div>
  );
}

/** Extracted so the usage bar's thresholds stay a flat, readable chain. */
function levelForUsage(pct: number): 'ok' | 'warn' | 'critical' {
  if (pct >= 95) return 'critical';
  if (pct >= 80) return 'warn';
  return 'ok';
}

function formatGB(gb: number): string {
  if (gb < 0.01) return '0 MB';
  if (gb < 1) return `${(gb * 1024).toFixed(0)} MB`;
  return `${gb.toFixed(2)} GB`;
}

function styleFromBranding(b?: Branding): CSSProperties {
  if (!b) return {};
  const style: CSSProperties = {};
  const vars = style as Record<string, string>;
  if (b.primaryColor) vars['--psx-primary'] = b.primaryColor;
  if (b.accentColor) vars['--psx-accent'] = b.accentColor;
  if (b.radius) vars['--psx-radius'] = b.radius;
  if (b.fontFamily) vars['--psx-font'] = b.fontFamily;
  return style;
}
