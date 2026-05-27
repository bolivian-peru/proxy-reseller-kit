'use client';

/**
 * @proxies-sx/pool-portal-react
 *
 * Drop-in React component + headless hooks for embedding a Proxies.sx Pool
 * Gateway reseller dashboard into any React app.
 *
 * @packageDocumentation
 */

export { PoolPortal } from './PoolPortal';
export type { PoolPortalProps } from './PoolPortal';

export { PoolSessionSpawner, buildProxyString } from './PoolSessionSpawner';
export type {
  PoolSessionSpawnerProps,
  SessionType,
  SpawnMeta,
} from './PoolSessionSpawner';

export { ActiveSessionsTable } from './ActiveSessionsTable';
export type { ActiveSessionsTableProps } from './ActiveSessionsTable';

export { PoolDocsPanel } from './PoolDocsPanel';
export type { PoolDocsPanelProps } from './PoolDocsPanel';

export { PakQuickstart } from './PakQuickstart';
export type { PakQuickstartProps } from './PakQuickstart';

export { PoolStockGrid } from './PoolStockGrid';
export type { PoolStockGridProps } from './PoolStockGrid';

export {
  usePoolKey,
  usePoolStock,
  useIncidents,
  useCopyToClipboard,
} from './hooks';

export type {
  Branding,
  Country,
  Incident,
  MeResponse,
  Pool,
  PoolPortalClassNames,
  PoolStock,
  Protocol,
  ProxyUrlPreferences,
  RotationMode,
} from './types';

// Re-export `buildProxyUrl` so callers don't need a second import
export { buildProxyUrl } from '@proxies-sx/pool-sdk';
