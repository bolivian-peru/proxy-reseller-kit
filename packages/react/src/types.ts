import type {
  Country,
  RotationMode,
  Protocol,
  Pool,
  PoolStock,
  CarrierStock,
  CarrierStockEntry,
  Incident,
} from '@proxies-sx/pool-sdk';

export type {
  Country,
  RotationMode,
  Protocol,
  Pool,
  PoolStock,
  CarrierStock,
  CarrierStockEntry,
  Incident,
};

/**
 * Shape returned by the host app's `/api/pool/me` endpoint. Represents the
 * currently authenticated customer's key + usage, plus the reseller's public
 * identifier needed to build proxy URLs in the browser.
 */
export interface MeResponse {
  /** The reseller's public `proxyUsername` (e.g. `psx_abc123`). Safe to expose. */
  proxyUsername: string;
  /** The customer's `pak_` key. Secret-ish — only expose to the authenticated customer. */
  pakKey: string;
  /** Mongo id of the pak_ record. */
  pakKeyId: string;
  /** Current usage snapshot. */
  usage: {
    usedMB: number;
    usedGB: number;
    capGB: number | null;
    enabled: boolean;
    lastUsedAt: string | null;
    /**
     * Optional ISO datetime when this customer's credits expire. The host
     * app's `/api/pool/me` endpoint should populate this from the pool key's
     * `expiresAt` field. `null` = no expiry.
     */
    expiresAt?: string | null;
    /** Server-computed: `true` when `expiresAt` is in the past. */
    isExpired?: boolean;
  };
  /** Optional: gateway host to use when building URLs. Defaults to gw.proxies.sx. */
  gatewayHost?: string;
}

/** User's current URL-builder preferences — managed via hooks or the component's internal state. */
export interface ProxyUrlPreferences {
  country?: Country;
  rotation?: RotationMode;
  sid?: string;
  protocol?: Protocol;
  pool?: Pool;
  carrier?: string;
  city?: string;
}

/** Branding overrides. Applied as CSS custom properties to the portal root. */
export interface Branding {
  name?: string;
  primaryColor?: string;
  logoUrl?: string;
  accentColor?: string;
  radius?: string;
  fontFamily?: string;
}

/** Fine-grained class name overrides — for Tailwind or custom CSS users. */
export interface PoolPortalClassNames {
  root?: string;
  card?: string;
  header?: string;
  proxyUrl?: string;
  usageBar?: string;
  select?: string;
  input?: string;
  button?: string;
  banner?: string;
}
