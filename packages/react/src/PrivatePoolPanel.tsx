'use client';

/**
 * @proxies-sx/pool-portal-react — PrivatePoolPanel
 *
 * A drop-in "Private Pool" management layout for reseller portals. It renders a
 * header (pool name + quality tier + optional usage bar), an optional
 * Reserved-IPs section, and the same session generator customers already use,
 * so a reseller can offer a branded Private Pool product with one component.
 *
 * A Private Pool is a `pak_` key minted with a quality tier:
 *   - `qualityTier: 'safe'`     → dedicated, modem-only (higher SLA)
 *   - `qualityTier: 'standard'` → modems + peer with automatic failover
 *
 * Mint the key SERVER-SIDE (the reseller API key must never reach the browser):
 *
 *   const key = await proxies.poolKeys.create({
 *     label: `private:${customerId}`,
 *     qualityTier: 'safe',      // dedicated modems
 *     trafficCapGB: 100,
 *   });
 *
 * then pass `key.key` (the `pak_...`) as `pak` here.
 */

import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { buildProxyUrl } from '@proxies-sx/pool-sdk';
import { PoolSessionSpawner, type PoolSessionSpawnerProps } from './PoolSessionSpawner';
import {
  usePoolCarrierStock,
  usePoolLeases,
  useLeaseActions,
  type LeaseActions,
  type LeaseFailover,
  type LeaseGateway,
  type LeaseRotationMode,
  type PoolLease,
} from './hooks';
import type { PoolPortalClassNames, Protocol } from './types';

export interface PrivatePoolPanelProps extends Omit<PoolSessionSpawnerProps, 'proxyPassword'> {
  /**
   * The Private Pool's `pak_` key (minted with a `qualityTier`). Used as the
   * proxy password.
   *
   * For Reserved IPs this MUST be the key of the very pool the handlers'
   * `privatePool.poolId` points at: the gateway only honours a `-pin-lease-`
   * for the pak that owns the lease, so any other key silently routes onto
   * ordinary shared stock.
   *
   * **The username that goes with it is not yours.** A Private Pool's pak is
   * minted under the platform's house reseller, and gateway auth rejects a pak
   * whose owner is not the account the username resolves to. With `apiRoute`
   * set, this panel reads the correct username off the pool itself and ignores
   * the `proxyUsername` prop — see {@link PrivatePoolPanelProps.apiRoute}.
   */
  pak: string;
  /** `'safe'` = dedicated modems only; `'standard'` = modems + peer with failover. Default `'standard'`. */
  qualityTier?: 'safe' | 'standard';
  /** Friendly pool name shown in the header. */
  label?: string;
  /** GB used so far — pass with `capGB` to render a usage bar. */
  usedGB?: number;
  /** GB cap — pass with `usedGB` to render a usage bar. `null`/omit → no bar. */
  capGB?: number | null;
  /** Reserved device-count intent, shown in the header subtitle. */
  deviceCount?: number;
  /**
   * Mount path of your `createPoolApiHandlers()`, e.g. `/api/pool`. Set it to
   * render the Reserved IPs section; it needs `privatePool` configured on those
   * handlers.
   *
   * It is also what makes the session generator correct. The handler returns the
   * pool's own connection facts (house `proxyUsername`, pool token, gateway
   * host, allowed countries), and the generator is signed with those — the
   * `proxyUsername` prop is IGNORED here, because a Private Pool pak
   * authenticates only against the house account that minted it. Omit
   * `apiRoute` and the panel is header + generator signed with the
   * `proxyUsername` you passed, which is right only if that account owns the
   * pak.
   *
   * @since 0.12.0
   */
  apiRoute?: string;
  /** Poll interval for the reserved-IP list, in ms. Default 15 000. @since 0.12.0 */
  leaseRefreshIntervalMs?: number;
  /** Ceiling on how many IPs one Reserve click may request. Default 25. @since 0.12.0 */
  maxReserveQuantity?: number;
}

export function PrivatePoolPanel(props: PrivatePoolPanelProps): JSX.Element {
  const {
    pak,
    qualityTier = 'standard',
    label,
    usedGB,
    capGB,
    deviceCount,
    apiRoute,
    leaseRefreshIntervalMs,
    maxReserveQuantity,
    className,
    style,
    ...spawnerProps
  } = props;

  const dedicated = qualityTier === 'safe';
  const tierLabel = dedicated ? 'Dedicated modems' : 'Modems + peer · auto-failover';
  const hasUsage = typeof usedGB === 'number' && typeof capGB === 'number' && capGB > 0;
  const pct = hasUsage ? Math.min(100, Math.round(((usedGB as number) / (capGB as number)) * 100)) : 0;

  const badgeStyle: CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '999px',
    background: dedicated ? 'rgba(16,185,129,0.15)' : 'rgba(139,92,246,0.15)',
    color: dedicated ? '#059669' : '#7c3aed',
  };

  return (
    <div className={['psx-font', 'psx-private-pool', className].filter(Boolean).join(' ')} style={style}>
      <div className="psx-private-pool-header" style={{ marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '1rem' }}>{label || 'Private Pool'}</strong>
          <span className="psx-tag" style={badgeStyle}>
            {tierLabel}
          </span>
          {typeof deviceCount === 'number' ? (
            <span style={{ fontSize: '12px', opacity: 0.7 }}>· {deviceCount} devices</span>
          ) : null}
        </div>
        {hasUsage ? (
          <div style={{ marginTop: '0.5rem' }}>
            <div style={{ fontSize: '12px', opacity: 0.7, marginBottom: 2 }}>
              {(usedGB as number).toFixed(2)} / {capGB} GB used
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.08)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 90 ? '#dc2626' : '#059669' }} />
            </div>
          </div>
        ) : null}
      </div>
      {apiRoute ? (
        <PrivatePoolConnected
          apiRoute={apiRoute}
          pak={pak}
          refreshIntervalMs={leaseRefreshIntervalMs}
          maxQuantity={maxReserveQuantity}
          spawner={spawnerProps}
        />
      ) : (
        <PoolSessionSpawner {...spawnerProps} proxyPassword={pak} />
      )}
    </div>
  );
}

/* ── The connected pool (Reserved IPs + generator) ────────────────────────
 *
 * Everything that needs the pool's LIVE connection lives here, because it all
 * needs the same one: the reserved-IP section and the session generator are both
 * built from the `gateway` block the handler returns, and both are wrong without
 * it. One component means one `usePoolLeases` poll and one source for the
 * credential identity — the generator cannot drift from the lease strings.
 *
 * Kept in this file, and deliberately NOT exported: reserving an exclusive
 * device only makes sense inside a Private Pool, and a second public component
 * would let a host mount it against a pool whose `pak` can't pin its leases.
 */

/** Idle windows the platform accepts (it clamps to [600, 43200] regardless). */
const IDLE_OPTS: { value: number; label: string }[] = [
  { value: 900, label: '15 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
  { value: 21600, label: '6 hours' },
  { value: 43200, label: '12 hours' },
];

/**
 * Failover scope, stored ON the lease. The honest part is `strict`: every other
 * value lets the gateway serve a request from ordinary stock while the held
 * device is offline (see the caveat rendered under the list).
 */
const FAILOVER_OPTS: { value: LeaseFailover; label: string; hint: string }[] = [
  {
    value: 'samecountry',
    label: 'Same country (default)',
    hint: 'While the held device is offline, requests are served by another device in the same country — not by your reserved IP.',
  },
  {
    value: 'samecarrier',
    label: 'Same carrier',
    hint: 'While the held device is offline, requests are served by another device on the same carrier.',
  },
  {
    value: 'samenode',
    label: 'Same relay node',
    hint: 'While the held device is offline, requests are served by another device on the same relay node.',
  },
  {
    value: 'any',
    label: 'Any available',
    hint: 'While the held device is offline, requests are served by any online device in the pool, in any country.',
  },
  {
    value: 'strict',
    label: 'Never substitute',
    hint: 'While the held device is offline, requests fail cleanly instead of coming from a different IP. The only setting that guarantees your reserved IP or nothing.',
  },
];

const ROTATION_OPTS: { value: LeaseRotationMode; label: string }[] = [
  { value: 'off', label: 'Hold — never rotate' },
  { value: 'auto5', label: 'Rotate every 5 min' },
  { value: 'auto10', label: 'Rotate every 10 min' },
  { value: 'auto20', label: 'Rotate every 20 min' },
  { value: 'auto60', label: 'Rotate every 60 min' },
];

const IP_CLASS_OPTS: { value: '' | 'mobile' | 'residential'; label: string; hint: string }[] = [
  { value: '', label: 'Any class', hint: 'Reserve whichever device is free — mobile or residential.' },
  {
    value: 'mobile',
    label: 'Mobile only',
    hint: 'Cellular-carrier exit IPs. Highest trust, but carrier CGNAT may re-issue the exit IP under you.',
  },
  {
    value: 'residential',
    label: 'Residential only',
    hint: 'Home / ISP exit IPs. These hold the same address for hours to days — the closest thing to a fixed IP.',
  },
];

interface PrivatePoolConnectedProps {
  apiRoute: string;
  pak: string;
  refreshIntervalMs?: number;
  maxQuantity?: number;
  /** Everything the host passed through for the generator, minus the password. */
  spawner: Omit<PoolSessionSpawnerProps, 'proxyPassword'>;
}

/**
 * Owns the single lease poll and hands the pool's live connection to both
 * consumers, so the generator can never disagree with the reserved-IP strings.
 *
 * The identity in that connection is the whole point. A Private Pool's `pak_`
 * is minted under the platform's HOUSE reseller (`private-pool.service.ts`
 * stamps `connection.proxyUsername = house.proxyUsername`), and gateway auth
 * resolves the account from the USERNAME, then refuses any pak whose owner is
 * not that account (`pak.resellerId !== user._id` → "Invalid credentials").
 * Signing the generator with the reseller's own `psx_` id therefore 407s every
 * single string — while the reserved-IP rows beside it, built from this same
 * object, keep working. That is why `proxyUsername` is forced here rather than
 * defaulted: there is no case where the caller's value is the right one.
 */
function PrivatePoolConnected(props: PrivatePoolConnectedProps): JSX.Element {
  const { apiRoute, pak, refreshIntervalMs, maxQuantity, spawner } = props;

  const leases = usePoolLeases(apiRoute, { refreshIntervalMs });
  const actions = useLeaseActions(apiRoute);
  const gateway = leases.data?.gateway ?? null;

  // Offer only the countries this pool may actually route to, lower-cased to
  // match the DSL the credential carries (the platform returns ISO-2 upper).
  // `undefined` rather than `[]` when the pool declares none, so the generator
  // falls back to its own list instead of rendering an empty picker. An explicit
  // `countries` prop still wins — the host may be scoping further.
  const poolCountries = useMemo(() => {
    const list = (gateway?.countries ?? []).map((c) => c.toLowerCase());
    return list.length > 0 ? list : undefined;
  }, [gateway]);

  return (
    <>
      <ReservedIps
        apiRoute={apiRoute}
        pak={pak}
        maxQuantity={maxQuantity}
        leases={leases}
        actions={actions}
        classNames={spawner.classNames}
      />
      {gateway ? (
        <PoolSessionSpawner
          {...spawner}
          proxyPassword={pak}
          proxyUsername={gateway.proxyUsername}
          gatewayHost={spawner.gatewayHost ?? gateway.host}
          countries={spawner.countries ?? poolCountries}
          defaultPool={spawner.defaultPool ?? gateway.poolToken}
        />
      ) : (
        <p className="psx-spawner-hint">
          {leases.loading
            ? 'Reading the connection for this pool…'
            : 'This pool has no live connection yet, so proxy URLs cannot be built for it.'}
        </p>
      )}
    </>
  );
}

interface ReservedIpsProps {
  apiRoute: string;
  pak: string;
  maxQuantity?: number;
  /** The shared lease poll, owned by {@link PrivatePoolConnected}. */
  leases: ReturnType<typeof usePoolLeases>;
  actions: LeaseActions;
  classNames?: PoolPortalClassNames;
}

function ReservedIps(props: ReservedIpsProps): JSX.Element {
  const { apiRoute, pak, maxQuantity = 25, leases, actions, classNames = {} } = props;

  const gateway = leases.data?.gateway ?? null;
  const rows = leases.data?.leases ?? [];
  const countries = gateway?.countries ?? [];

  const [country, setCountry] = useState('');
  const [carrier, setCarrier] = useState('');
  const [ipType, setIpType] = useState<'' | 'mobile' | 'residential'>('');
  const [idleTtlSec, setIdleTtlSec] = useState(IDLE_OPTS[0]!.value);
  const [failover, setFailover] = useState<LeaseFailover>('samecountry');
  const [quantity, setQuantity] = useState(1);
  const [protocol, setProtocol] = useState<Protocol>('http');
  const [reserveNote, setReserveNote] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // The pool decides which countries exist, and that list only arrives with the
  // first poll — so seed the selection from it rather than guessing 'us'. The
  // same effect re-seeds if the pool's allowed list later changes or empties: a
  // <select> whose value matches none of its options renders a different one, so
  // state that outlives the list would show one country and reserve in another.
  // Falling back to `''` when nothing is on offer is what re-disables Reserve.
  // Same rule as the generator's country picker (PoolSessionSpawner).
  useEffect(() => {
    if (!countries.includes(country)) setCountry(countries[0] ?? '');
  }, [country, countries]);

  // A carrier in one country doesn't exist in the next.
  useEffect(() => {
    setCarrier('');
  }, [country]);

  // Live carrier stock for the chosen country (counts only, never exit IPs).
  const carrierStock = usePoolCarrierStock(apiRoute, country.toLowerCase(), {
    refreshIntervalMs: 60_000,
  });
  const carriers = useMemo(
    () => (carrierStock.data?.carriers ?? []).filter((c) => c.count > 0),
    [carrierStock.data],
  );

  const failoverHint = FAILOVER_OPTS.find((f) => f.value === failover)?.hint ?? '';
  const ipClassHint = IP_CLASS_OPTS.find((c) => c.value === ipType)?.hint ?? '';
  const enabled = leases.data?.enabled ?? false;
  const atCap =
    typeof leases.data?.maxLeases === 'number' &&
    leases.data.maxLeases > 0 &&
    leases.data.poolHeld >= leases.data.maxLeases;

  const handleReserve = useCallback(async () => {
    setReserveNote(null);
    let held = 0;
    let lastError = '';
    // Sequential on purpose: each reservation claims its own device, and we stop
    // at the first refusal (no stock / at cap) rather than hammering the API.
    for (let i = 0; i < quantity; i++) {
      try {
        await actions.acquire({
          country: country.toLowerCase(),
          carrier: carrier || undefined,
          ipType: ipType || undefined,
          idleTtlSec,
          failover,
        });
        held += 1;
      } catch (err) {
        lastError = (err as Error).message;
        break;
      }
    }
    if (held > 0) {
      await leases.refetch().catch(() => {
        /* the poll will reconcile */
      });
      setReserveNote(
        held < quantity
          ? `Reserved ${held} of ${quantity}. The rest couldn't be held: ${lastError}`
          : `Reserved ${held} IP${held === 1 ? '' : 's'} in ${country}.`,
      );
      return;
    }
    setReserveNote(lastError || 'Could not reserve an IP right now.');
  }, [actions, carrier, country, failover, idleTtlSec, ipType, leases, quantity]);

  const handleAction = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        // `actions.error` already holds the platform's reason; it renders below.
        return;
      }
      await leases.refetch().catch(() => {
        /* the poll will reconcile */
      });
    },
    [leases],
  );

  const handleCopy = useCallback((url: string, leaseId: string) => {
    void navigator.clipboard?.writeText(url);
    setCopiedId(leaseId);
    setTimeout(() => setCopiedId((prev) => (prev === leaseId ? null : prev)), 1500);
  }, []);

  return (
    <div className="psx psx-reserved-ips" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: '0.95rem' }}>Reserved IPs</strong>
        <span style={{ fontSize: '12px', opacity: 0.7 }}>
          {leases.data ? `${leases.data.held} held by you · ${leases.data.poolHeld} of ${leases.data.maxLeases} in the pool` : 'Loading…'}
        </span>
      </div>
      <p className="psx-spawner-hint" style={{ margin: '0.35rem 0 0.75rem' }}>
        A reservation holds one device for you alone: nobody else in the pool is routed onto it
        until you release it, or until it sits idle for its window. It pins the <em>device</em>,
        not the address — a mobile carrier can still re-issue the exit IP underneath a held modem,
        so pick a residential IP class when you need the address itself to stay put.
      </p>

      {leases.error && (
        <p className={cn('psx-banner', 'psx-banner-error', classNames.banner)}>
          Couldn&apos;t load your reserved IPs: {leases.error.message}
        </p>
      )}
      {!leases.loading && leases.data && !enabled && (
        <p className={cn('psx-banner', 'psx-banner-warn', classNames.banner)}>
          Reserved IPs aren&apos;t switched on for this pool yet. Existing holds still work; new
          reservations will be refused until your provider enables them.
        </p>
      )}

      {/* ── Reserve ───────────────────────────────────────────────────── */}
      <div className={cn('psx-spawner-controls', classNames.card)}>
        <label className="psx-spawner-row">
          <span>Country</span>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={cn('psx-select', classNames.select)}
          >
            {countries.length === 0 && <option value="">Loading…</option>}
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="psx-spawner-hint">
            Only the countries this pool is allowed to reserve in.
          </span>
        </label>

        <label className="psx-spawner-row">
          <span>Carrier</span>
          <select
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className={cn('psx-select', classNames.select)}
          >
            <option value="">Any carrier</option>
            {carriers.map((c) => (
              <option key={`${c.name}-${c.asn ?? 'na'}`} value={c.name}>
                {c.name} ({c.ipType}) — {c.count}
              </option>
            ))}
          </select>
          <span className="psx-spawner-hint">
            {carrierStock.loading
              ? 'Reading live stock…'
              : `Live routable stock in ${country || 'this country'} — counts only, never addresses. Your pool may be able to hold fewer than shown.`}
          </span>
        </label>

        <label className="psx-spawner-row">
          <span>IP class</span>
          <select
            value={ipType}
            onChange={(e) => setIpType(e.target.value as typeof ipType)}
            className={cn('psx-select', classNames.select)}
          >
            {IP_CLASS_OPTS.map((c) => (
              <option key={c.value || 'any'} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <span className="psx-spawner-hint">{ipClassHint}</span>
        </label>

        <label className="psx-spawner-row">
          <span>Idle window</span>
          <select
            value={String(idleTtlSec)}
            onChange={(e) => setIdleTtlSec(Number(e.target.value))}
            className={cn('psx-select', classNames.select)}
          >
            {IDLE_OPTS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                Release after {o.label}
              </option>
            ))}
          </select>
          <span className="psx-spawner-hint">
            Hands the device back to the pool after this long with no traffic; every request resets
            the timer. This is the reservation&apos;s own window — it is not the session{' '}
            <code>-ttl-</code> in the generator below, which only sets how long a session row lives.
          </span>
        </label>

        <label className="psx-spawner-row">
          <span>If it drops</span>
          <select
            value={failover}
            onChange={(e) => setFailover(e.target.value as LeaseFailover)}
            className={cn('psx-select', classNames.select)}
          >
            {FAILOVER_OPTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span className="psx-spawner-hint">{failoverHint}</span>
        </label>

        <label className="psx-spawner-row">
          <span>How many</span>
          <input
            type="number"
            min={1}
            max={maxQuantity}
            value={quantity}
            onChange={(e) =>
              setQuantity(Math.max(1, Math.min(maxQuantity, Number(e.target.value) || 1)))
            }
            className={cn('psx-input', classNames.input)}
          />
          <span className="psx-spawner-hint">
            Reserved one at a time (1–{maxQuantity}); we stop at the first refusal and tell you how
            many you actually got.
          </span>
        </label>

        <button
          type="button"
          onClick={() => void handleReserve()}
          disabled={!enabled || atCap || actions.acquiring || !country}
          className={cn('psx-button', 'psx-button-primary', classNames.button)}
        >
          {actions.acquiring ? 'Reserving…' : `Reserve ${quantity} IP${quantity === 1 ? '' : 's'}`}
        </button>
      </div>

      {reserveNote && (
        <p className="psx-spawner-hint" style={{ marginTop: '0.5rem' }}>
          {reserveNote}
        </p>
      )}
      {atCap && (
        <p className={cn('psx-banner', 'psx-banner-warn', classNames.banner)}>
          The pool is holding {leases.data?.poolHeld} of its {leases.data?.maxLeases} reserved IPs.
          Release one to reserve another.
        </p>
      )}
      {actions.error && (
        <p className={cn('psx-banner', 'psx-banner-error', classNames.banner)}>
          {actions.error.message}
        </p>
      )}

      {/* ── Held IPs ──────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.75rem 0 0.5rem' }}>
          <span className="psx-spawner-hint">Connection strings as</span>
          <select
            value={protocol}
            onChange={(e) => setProtocol(e.target.value as Protocol)}
            className={cn('psx-select', classNames.select)}
          >
            <option value="http">HTTP (port 7000)</option>
            <option value="socks5">SOCKS5 (port 7001)</option>
          </select>
        </div>
      )}

      {!leases.loading && rows.length === 0 && (
        <p className="psx-spawner-hint">
          No reserved IPs yet. Reserve one above and that device is held for you until you release
          it or it goes idle.
        </p>
      )}

      {rows.map((lease) => (
        <LeaseRow
          key={lease.leaseId}
          lease={lease}
          gateway={gateway}
          pak={pak}
          protocol={protocol}
          busy={actions.busyLeaseId === lease.leaseId}
          copied={copiedId === lease.leaseId}
          classNames={classNames}
          onCopy={handleCopy}
          onRotate={() => void handleAction(() => actions.rotate(lease.leaseId))}
          onExtend={(sec) => void handleAction(() => actions.extend(lease.leaseId, sec))}
          onRelease={() => void handleAction(() => actions.release(lease.leaseId))}
          onRotationMode={(mode) => void handleAction(() => actions.setRotationMode(lease.leaseId, mode))}
          onIssueLink={() => void handleAction(() => actions.issueRotationLink(lease.leaseId))}
          onRevokeLink={() => void handleAction(() => actions.revokeRotationLink(lease.leaseId))}
        />
      ))}

      {rows.length > 0 && (
        <p className="psx-spawner-hint" style={{ marginTop: '0.5rem' }}>
          Two things worth knowing. First, a reservation is exclusive but not absolute: while the
          held device is <em>offline</em>, the gateway serves that request from ordinary pool stock
          under every failover setting except <strong>Never substitute</strong> — so a request
          during an outage may not come from your reserved IP. Your hold isn&apos;t lost either
          way. Second, rotating changes the device behind a reservation but never the connection
          string: copy it once and it keeps working.
        </p>
      )}
    </div>
  );
}

interface LeaseRowProps {
  lease: PoolLease;
  gateway: LeaseGateway | null;
  pak: string;
  protocol: Protocol;
  busy: boolean;
  copied: boolean;
  classNames: PoolPortalClassNames;
  onCopy: (url: string, leaseId: string) => void;
  onRotate: () => void;
  onExtend: (idleTtlSec: number) => void;
  onRelease: () => void;
  onRotationMode: (mode: LeaseRotationMode) => void;
  onIssueLink: () => void;
  onRevokeLink: () => void;
}

function LeaseRow(props: LeaseRowProps): JSX.Element {
  const {
    lease, gateway, pak, protocol, busy, copied, classNames,
    onCopy, onRotate, onExtend, onRelease, onRotationMode, onIssueLink, onRevokeLink,
  } = props;

  const url = useMemo(
    () => buildLeaseProxyUrl(gateway, pak, lease, protocol),
    [gateway, pak, lease, protocol],
  );

  return (
    <div
      style={{
        border: '1px solid var(--psx-border)',
        borderRadius: 'var(--psx-radius)',
        padding: '10px 12px',
        marginTop: '0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <code style={{ fontWeight: 600 }}>{lease.ipMasked ?? 'x.x.x.x'}</code>
        <span className="psx-spawner-hint">
          {lease.country} · {lease.carrier ?? 'unknown carrier'} · {lease.ipType}
        </span>
        <span className="psx-spawner-hint" style={{ marginLeft: 'auto' }}>
          {statusLine(lease)}
        </span>
      </div>

      {url ? (
        <div className="psx-url-row">
          <code className={cn('psx-url', classNames.proxyUrl)}>{url}</code>
          <button
            type="button"
            onClick={() => onCopy(url, lease.leaseId)}
            className={cn('psx-button', classNames.button)}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : (
        <p className="psx-spawner-hint">
          This pool has no live connection yet, so a credential can&apos;t be built for the hold.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <select
          value={lease.rotationMode}
          onChange={(e) => onRotationMode(e.target.value as LeaseRotationMode)}
          disabled={busy}
          className={cn('psx-select', classNames.select)}
        >
          {ROTATION_OPTS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <select
          value={String(lease.idleTtlSec)}
          onChange={(e) => onExtend(Number(e.target.value))}
          disabled={busy}
          className={cn('psx-select', classNames.select)}
        >
          {IDLE_OPTS.map((o) => (
            <option key={o.value} value={String(o.value)}>
              Release after {o.label}
            </option>
          ))}
          {/* A window the platform clamped to something outside our list must
              still render as itself, or the select would silently show — and on
              the next change, apply — a value the customer never chose. */}
          {IDLE_OPTS.every((o) => o.value !== lease.idleTtlSec) && (
            <option value={String(lease.idleTtlSec)}>
              Release after {Math.round(lease.idleTtlSec / 60)} minutes
            </option>
          )}
        </select>
        <button
          type="button"
          onClick={onRotate}
          disabled={busy}
          className={cn('psx-button', classNames.button)}
        >
          {busy ? 'Working…' : 'Rotate now'}
        </button>
        {lease.rotateUrl ? (
          <button
            type="button"
            onClick={onRevokeLink}
            disabled={busy}
            className={cn('psx-button', 'psx-button-ghost', classNames.button)}
            title={lease.rotateUrl}
          >
            Revoke rotation link
          </button>
        ) : (
          <button
            type="button"
            onClick={onIssueLink}
            disabled={busy}
            className={cn('psx-button', 'psx-button-ghost', classNames.button)}
          >
            Get rotation link
          </button>
        )}
        <button
          type="button"
          onClick={onRelease}
          disabled={busy}
          className={cn('psx-button', 'psx-button-danger', classNames.button)}
          style={{ marginLeft: 'auto' }}
        >
          Release
        </button>
      </div>

      {lease.rotateUrl && (
        <div className="psx-url-row">
          <code className={cn('psx-url', classNames.proxyUrl)}>{lease.rotateUrl}</code>
          <button
            type="button"
            onClick={() => onCopy(lease.rotateUrl!, `${lease.leaseId}-link`)}
            className={cn('psx-button', classNames.button)}
          >
            Copy
          </button>
        </div>
      )}
      {lease.rotateUrl && (
        <p className="psx-spawner-hint">
          Anyone with this URL can rotate this reservation — no login. Treat it as a secret; revoke
          it to kill it. It swaps the device, so it can&apos;t promise a particular new address.
        </p>
      )}
      <p className="psx-spawner-hint">
        Releases after {Math.round(lease.idleTtlSec / 60)} min with no traffic · rotated{' '}
        {lease.rotateCount}×
        {lease.rotationMode !== 'off'
          ? ' · auto-rotation only advances while the reservation is carrying traffic'
          : ''}
      </p>
    </div>
  );
}

/* ── Internal helpers ─────────────────────────────────────────────────── */

/**
 * Build the credential for one reservation.
 *
 * Three parts are not free choices:
 * - `proxyUsername` comes from the handler, not from the reseller's own
 *   `psx_` id — a Private Pool's pak is minted under the platform's house
 *   reseller, and gateway auth rejects a username that resolves elsewhere.
 * - `sid` is `hold_<leaseId>`. The platform tracks a reservation's liveness by
 *   matching exactly that session id, so connecting under any other sid makes
 *   a busy hold look idle and it gets reaped out from under you.
 * - `pin: lease` resolves to whichever device the reservation holds right now,
 *   which is why rotation never invalidates the string. Pinning the device id
 *   instead would break on the first rotation.
 */
function buildLeaseProxyUrl(
  gateway: LeaseGateway | null,
  pak: string,
  lease: PoolLease,
  protocol: Protocol,
): string | null {
  if (!gateway || !pak) return null;
  try {
    return buildProxyUrl(gateway.proxyUsername, pak, {
      pool: gateway.poolToken,
      country: lease.country.toLowerCase(),
      sid: `hold_${lease.leaseId}`,
      pin: { type: 'lease', id: lease.leaseId },
      rotation: 'sticky',
      failover: lease.failover,
      protocol,
      host: gateway.host,
    });
  } catch {
    // A malformed id would produce a string that silently routes onto shared
    // stock. Render nothing instead of something wrong.
    return null;
  }
}

function statusLine(lease: PoolLease): string {
  if (lease.deviceOnline) return 'Live';
  if (lease.failover === 'strict') {
    return 'Offline — requests fail cleanly, never substituted';
  }
  return 'Offline — requests served from shared stock until it returns';
}

function cn(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
