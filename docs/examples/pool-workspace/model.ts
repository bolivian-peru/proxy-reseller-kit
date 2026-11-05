import { buildProxyUrl } from '../../../packages/sdk/src/url';
import type { BuildProxyUrlOpts, CountryTier, PoolPricing, PoolStock } from '../../../packages/sdk/src/types';

/** Example host application model, not an additional SDK/public API. */
export type PoolChoice = 'all' | 'peer' | 'private-devices';
export type WorkspaceSettings = Pick<BuildProxyUrlOpts,
  'carrier' | 'isp' | 'asn' | 'ipType' | 'city' | 'state' | 'strict' | 'failover'> & {
  pool: PoolChoice;
  country: string;
  protocol: 'http' | 'socks5';
  rotation: 'sticky' | 'auto5' | 'auto10' | 'auto20' | 'auto60';
  ttl: number;
  sid: string;
};
export interface SavedList {
  id: string;
  name: string;
  createdAt: string;
  included: boolean;
  configurations: WorkspaceSettings[];
}
export type CountryAvailability =
  | { state: 'available' | 'empty'; count: number }
  | { state: 'unknown'; count: null };

/** UI "Private devices" means the shared mbl pool, not an exclusive lease. */
export function poolScopes(pool: PoolChoice): {
  connection: 'any' | 'peer' | 'mbl'; discovery: 'all' | 'peer' | 'mbl';
} {
  switch (pool) {
    case 'all': return { connection: 'any', discovery: 'all' };
    case 'peer': return { connection: 'peer', discovery: 'peer' };
    case 'private-devices': return { connection: 'mbl', discovery: 'mbl' };
    default: throw new Error('Choose a supported pool explicitly');
  }
}

function countIn(map: Record<string, number>, country: string): number | null {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const entries = Object.entries(map).filter(([code]) => code.toLowerCase() === country.toLowerCase());
  if (entries.length === 0) return 0;
  if (entries.length !== 1) return null;
  const count = entries[0][1];
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return count;
}

/** Country inventory before advanced filters; never an intersection or reservation. */
export function countryAvailability(
  stock: PoolStock | null, pool: PoolChoice, country: string,
  now = Date.now(), maxAgeMs = 90_000,
): CountryAvailability {
  poolScopes(pool);
  const at = Date.parse(stock?.generatedAt ?? '');
  if (!stock || !stock.pools || stock.stale || !/^[a-z]{2}$/i.test(country) || !Number.isFinite(at) || now - at > maxAgeMs || at - now > 30_000) {
    return { state: 'unknown', count: null };
  }
  const peer = countIn(stock.pools.peer, country);
  const modem = countIn(stock.pools.mbl, country);
  let count = peer;
  if (pool === 'private-devices') count = modem;
  if (pool === 'all') count = peer === null || modem === null ? null : peer + modem;
  if (count === null) return { state: 'unknown', count: null };
  return { state: count > 0 ? 'available' : 'empty', count };
}

export function countryTier(pricing: PoolPricing, country: string): CountryTier | null {
  if (!pricing || !Array.isArray(pricing.tiers)) return null;
  const cc = country.toLowerCase();
  const named = pricing.tiers.find(t => t && Array.isArray(t.countries)
    && t.countries.some(c => typeof c === 'string' && c.toLowerCase() === cc));
  return named ?? pricing.tiers.find(t => t && t.tier === pricing.defaultTier && t.countries === null) ?? null;
}

/** Estimate only: no rounding, negotiated wholesale rate or customer retail price here. */
export function weightedBalanceEstimate(
  rawGB: number, country: string, pricing: PoolPricing | null,
): number | null {
  if (!Number.isFinite(rawGB) || rawGB < 0 || !pricing || typeof pricing.live !== 'boolean') return null;
  if (!pricing.live) return rawGB;
  const tier = countryTier(pricing, country);
  if (!tier || !Number.isFinite(tier.burnRate) || tier.burnRate <= 0) return null;
  return rawGB * tier.burnRate;
}

function cleanSettings(value: WorkspaceSettings): WorkspaceSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved settings');
  poolScopes(value.pool);
  if (typeof value.country !== 'string' || !/^[a-z]{2}$/i.test(value.country)) throw new Error('Choose one ISO country');
  if (typeof value.sid !== 'string' || !/^[a-z0-9_]{1,64}$/.test(value.sid)) throw new Error('Use a saved opaque SID');
  if (!['http', 'socks5'].includes(value.protocol)) throw new Error('Unsupported protocol');
  if (!['sticky', 'auto5', 'auto10', 'auto20', 'auto60'].includes(value.rotation)) throw new Error('Unsupported rotation');
  if (!Number.isInteger(value.ttl) || value.ttl < 60 || value.ttl > 2_592_000) throw new Error('Invalid TTL');
  if (value.pool === 'private-devices' && (value.city || value.state)) throw new Error('City and state require peer-capable routing');
  if (value.pool === 'private-devices' && value.ipType && value.ipType !== 'mobile') throw new Error('Modem pool cannot match this IP class');
  if (value.ipType !== undefined && (typeof value.ipType !== 'string' || !['mobile', 'residential', 'datacenter'].includes(value.ipType))) throw new Error('Unsupported IP class');
  if (value.asn !== undefined && (!Number.isInteger(value.asn) || value.asn < 1 || value.asn > 9_999_999)) throw new Error('Invalid ASN');
  if (value.failover !== undefined && (typeof value.failover !== 'string' || !['any', 'samecountry', 'samecarrier', 'samenode', 'strict'].includes(value.failover))) throw new Error('Unsupported failover policy');
  for (const token of [value.carrier, value.isp, value.city, value.state]) {
    if (token !== undefined && (typeof token !== 'string' || !/^[a-z0-9_]{1,64}$/.test(token))) throw new Error('Use a supported discovery token');
  }
  if (value.strict !== undefined && typeof value.strict !== 'boolean') throw new Error('Invalid strict setting');
  if (value.strict === true && value.rotation !== 'sticky') throw new Error('Strict sticky is unavailable for timed rotation');
  return {
    pool: value.pool, country: value.country.toLowerCase(), protocol: value.protocol,
    rotation: value.rotation, ttl: value.ttl, sid: value.sid,
    carrier: value.carrier, isp: value.isp, asn: value.asn, ipType: value.ipType,
    city: value.city, state: value.state, strict: value.strict, failover: value.failover,
  };
}

/** Whitelist persisted fields; do not spread a credential-bearing form object. */
export function serializeSavedLists(lists: readonly SavedList[]): string {
  return JSON.stringify(lists.slice(0, 50).map(list => {
    if (!list || typeof list.id !== 'string' || !list.id || list.id.length > 128
      || typeof list.name !== 'string' || !list.name || list.name.length > 120
      || typeof list.createdAt !== 'string' || !Number.isFinite(Date.parse(list.createdAt))) {
      throw new Error('Invalid saved list');
    }
    if (typeof list.included !== 'boolean') throw new Error('Invalid include-in-copy flag');
    if (!Array.isArray(list.configurations) || list.configurations.length < 1 || list.configurations.length > 1000) {
      throw new Error('A saved list needs 1–1000 configurations');
    }
    return {
      id: list.id, name: list.name, createdAt: list.createdAt, included: list.included === true,
      configurations: list.configurations.map(cleanSettings),
    };
  }));
}

/** Treat browser storage as untrusted. A malformed value reports an error, not fresh empty data. */
export function parseSavedLists(text: string | null): SavedList[] {
  if (text === null) return [];
  if (text.length > 2_000_000) throw new Error('Saved lists exceed the local storage bound');
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Saved lists are not an array');
  return JSON.parse(serializeSavedLists(parsed)) as SavedList[];
}

/** Persist caller-allocated settings/SIDs; newer lists first, at most 50 retained. */
export function prependSavedList(lists: readonly SavedList[], next: SavedList): SavedList[] {
  return parseSavedLists(serializeSavedLists([next, ...lists.filter(list => list.id !== next.id)]));
}

export function exportConfiguration(
  settings: WorkspaceSettings, proxyUsername: string, currentCustomerPak: string,
): string {
  const clean = cleanSettings(settings);
  return buildProxyUrl(proxyUsername, currentCustomerPak, {
    ...clean, pool: poolScopes(clean.pool).connection,
  });
}

/** Call only after resolving this signed-in customer's CURRENT credential. Do not persist the result. */
export function copyIncludedLists(
  lists: readonly SavedList[], proxyUsername: string, currentCustomerPak: string,
): string {
  return lists.filter(list => list.included)
    .flatMap(list => list.configurations.map(settings => exportConfiguration(settings, proxyUsername, currentCustomerPak)))
    .join('\n');
}
