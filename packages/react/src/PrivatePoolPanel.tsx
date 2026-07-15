'use client';

/**
 * @proxies-sx/pool-portal-react — PrivatePoolPanel
 *
 * A drop-in "Private Pool" management layout for reseller portals. It renders a
 * header (pool name + quality tier + optional usage bar) over the same session
 * generator customers already use, so a reseller can offer a branded Private
 * Pool product with a single component.
 *
 * A Private Pool is just a `pak_` key minted with a quality tier:
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

import { type CSSProperties, type JSX } from 'react';
import { PoolSessionSpawner, type PoolSessionSpawnerProps } from './PoolSessionSpawner';

export interface PrivatePoolPanelProps extends Omit<PoolSessionSpawnerProps, 'proxyPassword'> {
  /** The Private Pool's `pak_` key (minted with a `qualityTier`). Used as the proxy password. */
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
}

export function PrivatePoolPanel(props: PrivatePoolPanelProps): JSX.Element {
  const {
    pak,
    qualityTier = 'standard',
    label,
    usedGB,
    capGB,
    deviceCount,
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
      <PoolSessionSpawner {...spawnerProps} proxyPassword={pak} />
    </div>
  );
}
