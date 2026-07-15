/**
 * @proxies-sx/pool-sdk
 *
 * Typed client for the Proxies.sx Pool Gateway reseller API.
 *
 * @packageDocumentation
 */

export { ProxiesClient, PoolKeysApi, PoolApi, SessionsApi } from './client';
export { buildProxyUrl, GATEWAY_HOST, HTTP_PORT, SOCKS5_PORT } from './url';
export {
  ProxiesError,
  ProxiesApiError,
  ProxiesTimeoutError,
  ProxiesConfigError,
} from './errors';
export type {
  Country,
  KnownCountry,
  RotationMode,
  Pool,
  Protocol,
  PoolQualityTier,
  PoolAccessKey,
  CreatePoolAccessKeyInput,
  UpdatePoolAccessKeyInput,
  TopUpPoolAccessKeyInput,
  PakAuditAction,
  PoolAccessKeyAuditEvent,
  AuditQueryOpts,
  RetryConfig,
  ActiveSession,
  ActiveSessionsResponse,
  BuildProxyUrlOpts,
  PoolStock,
  CarrierStock,
  CarrierStockEntry,
  Incident,
  ClientConfig,
} from './types';

export { isPoolKeyExpired, daysUntilPoolKeyExpiry } from './types';
