'use client';

import {
  type CSSProperties,
  type ReactNode,
  useMemo,
  useState,
} from 'react';
import { buildProxyUrl } from '@proxies-sx/pool-sdk';
import type {
  Branding,
  Country,
  PoolPortalClassNames,
  Protocol,
  RotationMode,
} from './types';
import {
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

  const { copy, copied } = useCopyToClipboard();

  const proxyUrl = useMemo(() => {
    if (!me.data) return '';
    try {
      return buildProxyUrl(me.data.proxyUsername, me.data.pakKey, {
        country,
        rotation,
        protocol,
        sid: sid || undefined,
        host: me.data.gatewayHost,
      });
    } catch {
      return '';
    }
  }, [me.data, country, rotation, protocol, sid]);

  const rootStyle: CSSProperties = {
    ...styleFromBranding(branding),
    ...style,
  };

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
              onClick={() => me.refetch()}
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

  const usage = me.data.usage;
  const usagePct = usage.capGB && usage.capGB > 0
    ? Math.min(100, (usage.usedGB / usage.capGB) * 100)
    : null;

  // ---------- Main render ----------

  return (
    <div
      className={cx('psx-pool-portal', classNames?.root, className)}
      style={rootStyle}
      data-protocol={protocol}
    >
      {/* Incident banner */}
      {showIncidents && incidents.data && incidents.data.length > 0 && (
        <div className={cx('psx-banner', 'psx-banner-warn', classNames?.banner)}>
          <strong>{incidents.data[0]!.title}</strong>
          {incidents.data[0]!.description && (
            <div style={{ fontSize: 12, marginTop: 2 }}>{incidents.data[0]!.description}</div>
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
            <StockIndicator country={country} stock={stock.data} />
          )}
        </div>

        {/* Proxy URL */}
        <div className="psx-field">
          <label className="psx-label">Your proxy URL</label>
          <div className={cx('psx-url-row', classNames?.proxyUrl)}>
            <code className="psx-url">{proxyUrl}</code>
            <button
              type="button"
              onClick={() => copy(proxyUrl)}
              className={cx('psx-button', 'psx-button-primary', classNames?.button)}
              aria-label="Copy proxy URL"
            >
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
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
                {formatGB(usage.usedGB)}
                {usage.capGB !== null && ` / ${formatGB(usage.capGB)}`}
              </span>
            </div>
            {usagePct !== null ? (
              <div className={cx('psx-usage-bar', classNames?.usageBar)}>
                <div
                  className="psx-usage-bar-fill"
                  style={{ width: `${usagePct}%` }}
                  data-level={
                    usagePct >= 95 ? 'critical' : usagePct >= 80 ? 'warn' : 'ok'
                  }
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
              onClick={() => onRegenerateKey()}
              className={cx('psx-button', 'psx-button-ghost', classNames?.button)}
            >
              Regenerate key
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
  stock,
}: {
  country: Country;
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
  const k = country.toLowerCase();
  const mbl = stock.pools?.mbl?.[k] ?? 0;
  const peer = stock.pools?.peer?.[k] ?? 0;
  const online = mbl + peer;
  if (online === 0) return null;
  const healthy = online >= 3;
  return (
    <div
      className="psx-stock"
      data-healthy={healthy}
      title={`${online} live endpoints in ${country.toUpperCase()}`}
    >
      <span className="psx-stock-dot" />
      <span className="psx-stock-count">{online}</span>
    </div>
  );
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
