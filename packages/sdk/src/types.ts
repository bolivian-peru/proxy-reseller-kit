/**
 * Countries that the Proxies.sx Pool Gateway routes to.
 *
 * @remarks
 * `KnownCountry` is the literal union of countries online today (2026). It
 * gives autocomplete in IDEs without locking the public API to today's
 * pool composition. Use it as a hint, not as a contract — the field type
 * on `BuildProxyUrlOpts.country` is `Country` (broader) for forward
 * compatibility when new countries come online.
 *
 * For the live list, call {@link ProxiesClient.pool.getStock}.
 */
export type KnownCountry =
  // mbl (production ProxySmart modem) countries — the supportive starter tier:
  | 'us' | 'gb' | 'fr' | 'nl' | 'pl' | 'ge'
  // Additional codes seen in live `getStock()` snapshots. peer — the flagship
  // network — spans ~80+ countries; these are a sampling (incl. de / es, which
  // are peer-only: they have NO mbl stock):
  | 'de' | 'es' | 'ch' | 'pa' | 'am';

/**
 * ISO 2-letter country code. Lowercase. Validated server-side against the
 * live pool inventory — passing a country with no online endpoints will
 * return `502` from the gateway with a message listing available alternatives.
 *
 * Prefer `KnownCountry` (the literal union) where you want IDE autocomplete.
 */
export type Country = KnownCountry | (string & {});

/**
 * IP rotation strategy encoded in the proxy username.
 *
 * IMPORTANT — what "sticky" actually means (May 2026, gateway #295 Phase 1):
 *
 *   Sticky pins the **modem**, not the IP. Mobile carriers operate CGNAT
 *   pools that re-issue egress IPs to a held modem connection on their own
 *   cadence (T-Mobile rotates aggressively; Verizon less so). The gateway
 *   compensates by smart-selecting the most IP-stable modem in the requested
 *   country: it tracks observed rotation rate per modem and weights that at
 *   50% of the selection score when rotation is `sticky` or `hard`.
 *
 *   For workflows that need a TRULY immutable IP (cf_clearance, banking,
 *   mTLS bound to source IP), use the `peer` pool (community SDK network) — real home/ISP
 *   IPs hold for hours-to-days. See the wiki page "Sticky Sessions and
 *   Rotation" for the full Layer-1-vs-Layer-2 explanation.
 *
 * Behavior at the gateway level:
 *
 * - `none` — A CLIENT-SIDE sentinel meaning "send no `-rot-` token", NOT a
 *   gateway mode. The gateway has no `none`; with no token it applies its own
 *   default, which is `auto10` — soft rotation, a different endpoint roughly
 *   every 10 minutes. It does NOT hold one endpoint for an hour, and it does
 *   NOT give a fresh IP per request. If you want either of those, ask for them
 *   explicitly: `sticky` to hold, `auto5` to turn over faster.
 * - `auto5` / `auto10` / `auto20` / `auto60` — Soft rotation: every N
 *   minutes the gateway swaps the modem, preferring empty and healthy ones.
 * - `ondemand` — No auto-rotate timer; reuse the chosen modem while connected.
 * - `sticky` — Pin to one modem for the session lifetime. Selector weights
 *   `ipStabilityScore` at 50% — picks the most IP-stable modem available.
 * - `hard` — **Identical to `sticky` at routing time.** The gateway maps both
 *   to a rotation interval of `0` and runs them through the same pinned path:
 *   same stability-weighted selection, same 60s offline-blip tolerance on
 *   session reuse, same exclusion from connect-phase re-selection. It does NOT
 *   mean "a fresh TCP connection picks a different modem" and it does NOT mean
 *   "a new IP per request". A true carrier-IP reset is a separate, explicit
 *   `/rotate` action (a ProxySmart airplane-mode toggle) that peers do not
 *   support at all. Prefer `sticky` in new code — `hard` exists for
 *   credentials already in customers' hands.
 *
 * **Every mode above needs a `sid` to mean anything across connections.**
 * Without one the gateway synthesizes a throwaway session per connection, so
 * `sticky` does not stick and `auto*` has nothing to rotate. Conversely, for
 * parallel workers that each want their own stable modem, give each worker its
 * own `sid` — the session id is what separates them, not the rotation mode.
 *
 * Tokens emitted: `-rot-{mode}`. `none` and `auto10` (the gateway default)
 * emit no token.
 */
export type RotationMode =
  | 'none'          // no -rot- token; gateway uses default
  | 'auto5'         // new modem every 5 min
  | 'auto10'        // new modem every 10 min (default)
  | 'auto20'        // new modem every 20 min
  | 'auto60'        // new modem every 60 min
  | 'ondemand'      // reuse while connected; no timer
  | 'sticky'        // pin one modem; gateway smart-picks the most IP-stable.
                    // Needs a sid to persist. Pair with the `peer`
                    // (community/residential) pool for a near-immutable IP.
  | 'hard';         // EXACTLY equivalent to `sticky` at routing time. Not a new
                    // modem per connection, not a new IP per request.

/**
 * Pool the customer's traffic routes through.
 * - `mbl`  — Production ProxySmart **mobile modems** (real 4G/5G carrier IPs, monitored quality).
 * - `peer` — The **community SDK network**: real devices sharing bandwidth. Mixed IP
 *            types — mostly **mobile + residential home/ISP** (NOT "residential only").
 * - `any`  — Best available across both pools (mobile modems first, peers as fallback).
 * - `best` — Alias of `any`.
 *
 * Country availability differs per pool — a country may have modem stock but no
 * peers, or vice-versa. Filter your country picker by the selected pool.
 */
export type Pool = 'mbl' | 'peer' | 'any' | 'best';

/** Network protocol for the proxy URL. HTTP port 7000, SOCKS5 port 7001. */
export type Protocol = 'http' | 'socks5';

/** Pool Access Key (`pak_*`) — one per customer or campaign. */
export interface PoolAccessKey {
  /** MongoDB ObjectId of the key record. */
  id: string;
  /**
   * The secret key itself, `pak_{24 hex}`. Treat as credential material.
   *
   * **Revocation is not instantaneous — budget ~30 seconds, plus open
   * tunnels.** Rotating via {@link PoolKeysApi.regenerate}, disabling via
   * `update({ enabled: false })`, deleting, and expiry all take effect at the
   * platform the moment the write lands, but the gateway caches each
   * `(username, password)` auth result for **30 s** (`CACHE_TTL_MS`,
   * `gateway/src/auth/http-auth.ts`). Until that entry ages out, the OLD
   * secret still authenticates new connections. Connections already
   * established are never re-authenticated, so an open CONNECT tunnel keeps
   * flowing until the client or the endpoint closes it — a long-lived tunnel
   * can outlive revocation by far more than 30 s. There is also a fail-open
   * grace path (`GW_AUTH_GRACE_MS`, default 15 min) that serves the
   * last-known-good result **only while the platform API is unreachable**; a
   * real rejection from a reachable API is always honoured.
   *
   * Practical consequence for a leaked key: regenerate immediately, then treat
   * the old value as live for at least the next 30 s of new connections and
   * for the lifetime of whatever tunnels are already open. Note that
   * {@link SessionsApi.closeAll} does NOT shorten this — it deletes the Redis
   * session rows, so the next connection re-selects an endpoint, but it does
   * not destroy sockets that are already carrying traffic. Cutting live
   * traffic dead is a support/ops action, not an API one. Metering is
   * unaffected throughout — every byte is still billed to the key that
   * carried it.
   */
  key: string;
  /** Human-friendly label shown in your admin (e.g. `"customer:alice@acme.com"`). */
  label: string;
  /**
   * `false` disables the key; `true` re-enables. The platform write is
   * immediate but the gateway is not — see the revocation-latency note on
   * {@link key}. Auto-flipped to `false` by the platform when the key passes
   * {@link trafficCapGB} or {@link expiresAt}; {@link PoolKeysApi.topUp} does
   * NOT re-enable a suspended key, you must `update({ enabled: true })`.
   */
  enabled: boolean;
  /**
   * Maximum GB this key can consume. Once `trafficUsedMB / 1024` reaches this
   * value the platform flips {@link enabled} to `false` and the gateway
   * rejects the key with `E_CAP_EXCEEDED`.
   *
   * **`null` is partner-only — for an ordinary reseller it is not "unlimited",
   * it is a `400`.** The platform rejects an uncapped key with
   * *"An unlimited pool-access-key requires a partner account. Set a GB cap for
   * this key."* unless the account is flagged `poolFreeBandwidth` (partner
   * accounts that settle wholesale out-of-band) or is an admin. A finite cap
   * must also be `> 0` and `<= RESELLER_MAX_PAK_CAP_GB` (platform default
   * `1000`; ask support to raise it) — outside that range is likewise a `400`.
   * The same guard runs on {@link PoolKeysApi.update} and on the resulting cap
   * in {@link PoolKeysApi.topUp}, so a key cannot be walked past the ceiling
   * after minting.
   *
   * You will still read `null` here on keys minted by a partner account.
   * There it means uncapped — metering continues, but nothing auto-suspends,
   * so the reseller's own shared traffic balance is the only backstop.
   *
   * `0` is not a "blocked" sentinel you can write: it fails the same
   * `cap > 0` check and comes back as a `400`. Reading a `0` off a legacy
   * record means the key is already at/over its cap, so the gateway rejects it
   * with `E_CAP_EXCEEDED`. To stop a key, use `update({ enabled: false })`.
   */
  trafficCapGB: number | null;
  /** Bytes consumed so far, in megabytes (fractional). */
  trafficUsedMB: number;
  /** Same value as {@link trafficUsedMB} but expressed in GB for display. */
  trafficUsedGB?: number;
  /**
   * Optional ISO datetime when this key stops working. After this moment,
   * gateway requests are rejected and the platform's nightly cron flips
   * `enabled` to `false`. `null` = no expiry.
   *
   * Common pattern: ship a "60-day" credit by setting this to
   * `new Date(Date.now() + 60*86400_000).toISOString()` on mint, then
   * extending it on each top-up via `update({ expiresAt })` or — preferred —
   * {@link PoolKeysApi.topUp}.
   */
  expiresAt: string | null;
  /**
   * Convenience flag computed server-side: `true` if `expiresAt` is in
   * the past. Use this in dashboards before the nightly cron has run.
   */
  isExpired?: boolean;
  /** ISO timestamp of the last request seen through the gateway, or null. */
  lastUsedAt: string | null;
  /** Unix ms when the key was first minted. */
  createdAt: number;
  /** Unix ms when the key was last modified. */
  updatedAt?: number;
}

/** Input to {@link PoolKeysApi.create}. */
/**
 * Quality tier — the **Private Pool** primitive.
 * - `'standard'` (default): routes across production modems **and** peer devices,
 *   modem-preferred, with automatic mbl→peer failover. The general Pool Gateway tier.
 * - `'safe'`: routes ONLY production ProxySmart modems — a dedicated, modem-grade
 *   allocation. Pass this to sell a customer an isolated, higher-SLA **Private Pool**.
 *   The gateway rewrites any `-peer-`/`-any-` request on a safe key back to `-mbl-`.
 */
export type PoolQualityTier = 'safe' | 'standard';

export interface CreatePoolAccessKeyInput {
  /** Human label. Must be non-empty. Shown in your admin; never sent to the gateway. */
  label: string;
  /**
   * Traffic cap in GB. Required in practice: `null`/omitted mints an uncapped
   * key, which the platform allows only for partner accounts and otherwise
   * rejects with a `400`. Must be `> 0` and within the per-key ceiling.
   * See {@link PoolAccessKey.trafficCapGB} for the exact rules.
   */
  trafficCapGB?: number | null;
  /**
   * Quality tier — pass `'safe'` to mint a modem-only **Private Pool** key, or
   * omit / `'standard'` for the general modems+peer tier. See {@link PoolQualityTier}.
   */
  qualityTier?: PoolQualityTier;
  /**
   * Optional expiry. Accepts ISO 8601 string or `Date`. The platform validates
   * it must be in the future (use `enabled: false` to disable a key, or
   * `null` to remove an existing expiry on update).
   */
  expiresAt?: string | Date | null;
  /**
   * Idempotency key (UUIDv4 recommended). When set, the platform dedupes
   * retries within a 24h window: the first call mints a key and records
   * the response; subsequent calls with the same `idempotencyKey` return
   * the cached response without minting a second key.
   *
   * Critical for webhook handlers and payment flows where a 504/network
   * blip would otherwise cause double-mints. If omitted, the SDK auto-
   * generates one (recommended) — but pass your own when you want it tied
   * to a domain object (e.g. your `payment_intent_id`).
   *
   * @since 0.3.0
   */
  idempotencyKey?: string;
}

/**
 * Action recorded in the pool-access-key audit log.
 * Mutations + security-relevant gateway events. List polling is NOT
 * audited (would dominate the collection without forensic value).
 *
 * @since 0.5.0
 */
export type PakAuditAction =
  | 'create'
  | 'update'
  | 'topup'
  | 'regenerate'
  | 'reveal'
  | 'delete'
  | 'gateway_auth_success'
  | 'gateway_auth_failure'
  | 'auto_suspended_cap_exceeded'
  | 'auto_suspended_expired';

/**
 * Single audit event on a `pak_` key. Server retains for 90 days
 * (TTL index) — archive to your own SIEM if you need longer retention.
 *
 * @since 0.5.0
 */
export interface PoolAccessKeyAuditEvent {
  /** Unique event id. */
  id: string;
  /** Key id this event relates to. Omitted on the per-key endpoint (redundant). */
  pakId?: string;
  /** What happened. See {@link PakAuditAction}. */
  action: PakAuditAction;
  /** Source IP that triggered the event. `null` for system / cron actions. */
  ip: string | null;
  /** Caller user-agent (for HTTP-driven actions). */
  userAgent: string | null;
  /** `X-Request-ID` value at the time of the event — cross-correlate with gateway logs. */
  requestId: string | null;
  /**
   * Auth method that produced the event:
   *   - `'jwt'` — interactive session (admin or reseller portal)
   *   - `'apiKey'` — server-side automation (your `psx_` SDK calls)
   *   - `'gateway'` — byte-flow event from the gateway
   *   - `'system'` — cron-driven (auto-suspend, expiry sweep)
   */
  authMethod: 'jwt' | 'apiKey' | 'gateway' | 'system' | null;
  /**
   * Action-specific context. Examples:
   *   - `create`: `{ label, trafficCapGB, expiresAt }`
   *   - `update`: `{ fields: string[], values: object }`
   *   - `topup`: `{ addTrafficGB, extendDays, newTrafficCapGB, newExpiresAt }`
   *   - `regenerate`: `{ newKeyPrefix }` (NOT the full new key)
   *   - `reveal`: `{ keyPrefix, label }`
   *   - `gateway_auth_failure`: `{ reason, usedGB?, capGB? }`
   *   - `auto_suspended_cap_exceeded`: `{ usedGB, capGB, label }`
   */
  metadata: Record<string, any>;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * Filters and pagination for {@link PoolKeysApi.audit} /
 * {@link PoolKeysApi.auditForKey}.
 *
 * @since 0.5.0
 */
export interface AuditQueryOpts {
  /** Filter by action. Cross-key endpoint only — per-key returns all actions. */
  action?: PakAuditAction;
  /** Page back: return events strictly older than this ISO datetime. */
  before?: string | Date;
  /** Cap: 1–500 (cross-key) or 1–200 (per-key). Server clamps. */
  limit?: number;
}

/** Input to {@link PoolKeysApi.update}. */
export interface UpdatePoolAccessKeyInput {
  label?: string;
  enabled?: boolean;
  /**
   * Replace the cap. Runs the same backing guard as mint — `null` is
   * partner-only and a value outside `0 < cap <= ceiling` is a `400`, so a key
   * cannot be edited into an uncapped one after creation. See
   * {@link PoolAccessKey.trafficCapGB}. To ADD GB to the existing cap, use
   * {@link PoolKeysApi.topUp} instead (atomic `$inc`, no read-modify-write race).
   */
  trafficCapGB?: number | null;
  /** Switch a key between the modem-only Private Pool tier and the general tier. See {@link PoolQualityTier}. */
  qualityTier?: PoolQualityTier;
  /**
   * Pass an ISO/Date in the future to set or extend, `null` to remove an
   * existing expiry, or omit to leave unchanged.
   *
   * For top-ups (extending an existing credit), prefer {@link PoolKeysApi.topUp}
   * — it's a single atomic write and protects against read-modify-write
   * races when concurrent top-ups land on the same key.
   */
  expiresAt?: string | Date | null;
}

/**
 * Input to {@link PoolKeysApi.topUp}. All fields optional but at least
 * one of `addTrafficGB` / `extendDays` should be set.
 *
 * @since 0.3.0
 */
export interface TopUpPoolAccessKeyInput {
  /**
   * Additional GB to add to `trafficCapGB`. The cap is incremented
   * atomically server-side. If the existing cap is `null` (unbounded),
   * the cap stays `null` — passing this on an unbounded key is a no-op.
   */
  addTrafficGB?: number;
  /**
   * Days to extend the expiry. The new `expiresAt` is computed server-side
   * as `max(now, current_expiresAt) + extendDays` — so a top-up always
   * extends from the *later* of "now" and the existing expiry, never
   * shortens. If the key has no expiry, this sets one to `now + extendDays`.
   */
  extendDays?: number;
  /**
   * Idempotency key (UUIDv4 recommended). Same semantics as
   * {@link CreatePoolAccessKeyInput.idempotencyKey} — protects against
   * double-credits if the request is retried after a 504.
   *
   * Tie this to your top-up's domain ID (e.g. `topup_${invoiceId}`) for
   * effortless deduplication across retries.
   */
  idempotencyKey?: string;
}

/**
 * Target of a `-pin-<type>-<id>` token — routes every request in the session to
 * one specific endpoint instead of letting the selector choose.
 *
 * - `port` / `device` — a specific modem. Ids come from support; you cannot
 *   derive them.
 * - `lease` — a **Reserved IP** lease (the Private Pool product). The gateway
 *   resolves the lease id through a platform-owned pointer to whichever
 *   endpoint the lease currently holds, so the credential keeps working when
 *   the lease is moved to a different modem. Lease ids look like
 *   `l23d4e83c5b`: the letter `l` followed by 8–12 lowercase letters/digits.
 *
 * **The id is the one DSL value the gateway does NOT sanitize** — it is read
 * raw out of the username. A hyphen inside it splits the token, and an
 * unresolvable pin does not error: the request silently falls through to
 * ordinary shared selection, which for a Reserved IP is worse than no pin at
 * all. {@link buildProxyUrl} therefore validates the id at build time and
 * throws {@link ProxiesConfigError}.
 *
 * @since 0.10.0 — `lease` added.
 */
export interface PinConfig {
  /** What the id refers to. `lease` = Reserved IP; `port`/`device` = a specific modem. */
  type: 'port' | 'device' | 'lease';
  /**
   * The pin target id. `[a-z0-9_]`, 1–64 chars, no hyphen. For
   * `type: 'lease'` it must additionally match the lease shape
   * `^l[a-z0-9]{8,12}$` — the gateway returns no endpoint for any other shape.
   */
  id: string;
}

/** Optional tokens appended to the proxy username. All fields are optional. */
export interface BuildProxyUrlOpts {
  /** ISO country code. If omitted, any country in the pool is eligible. */
  country?: Country;
  /** Carrier name (e.g. `"att"`, `"tmobile"`). Soft preference, mostly for modems. */
  carrier?: string;
  /**
   * ISP slug — HARD prefix match against the endpoint's ISP name (peer pool).
   * Use for residential carrier targeting, e.g. `"tmobile"`, `"comcast"`.
   * Live per-carrier stock: {@link PoolApi.getCarrierStock}.
   */
  isp?: string;
  /**
   * Numeric ASN — HARD exact match (peer pool). The most precise carrier
   * filter, e.g. `21928` (T-Mobile). Pairs with {@link PoolApi.getCarrierStock}.
   */
  asn?: number;
  /** City name (e.g. `"nyc"`, `"berlin"`). Carrier-level precision recommended over city. */
  city?: string;
  /**
   * Hard IP-type class filter. Restricts selection to `mobile`
   * (carrier modems + mobile peers), `residential` (home/ISP peers), or
   * `datacenter` (hosting IPs). Omit for any class.
   *
   * **Emission contract: always emitted as `-iptype-<v>` when set, for every
   * pool.** {@link buildProxyUrl} does NOT gate this on `pool` — not on
   * `peer`, and not on anything else. It looks tempting to suppress it for
   * `mbl` (whose modems are all `mobile` anyway), but that would silently
   * change routing: `mbl` + `residential` must reach the gateway so it can
   * answer `502 E_NO_STOCK_COUNTRY`, which tells the caller their filter is
   * unsatisfiable. Dropping the token instead would hand them mobile IPs while
   * they believe they asked for residential. Any wrapper around this builder
   * must keep the same rule.
   */
  ipType?: 'mobile' | 'residential' | 'datacenter';
  /**
   * Failover scope when the chosen endpoint is unavailable. `samecountry`
   * (the gateway default) is omitted from the URL; any other value emits
   * `-failover-<v>`. `strict` disables substitution.
   */
  failover?: 'any' | 'samecountry' | 'samecarrier' | 'samenode' | 'strict';
  /**
   * Session-row TTL in seconds. This is the session-row lifetime, NOT an
   * IP-hold guarantee — carrier CGNAT may re-NAT the exit IP within the TTL.
   *
   * **Emission contract: CLAMPED, never dropped and never thrown.** Any finite
   * number you pass is rounded and clamped into `60..2_592_000` (1 min – 30
   * days) and always emitted as `-ttl-<n>`. This mirrors the gateway, which
   * clamps to exactly the same bounds and records a `corrections[]` entry
   * rather than erroring. A wrapper that instead *omits* an out-of-range ttl
   * is a behaviour change, not a nicety: omitting the token silently falls
   * back to the gateway default of 3600, so a caller asking for a 7-day
   * session gets a 1-hour one and finds out when their sticky session dies
   * overnight. Clamp, don't drop.
   *
   * **TTL is fixed for the life of a session row.** The gateway stamps the TTL
   * when the row is created and every subsequent request re-expires the row
   * using that *stored* value. Changing `ttl` on a URL that reuses an existing
   * `sid` therefore does nothing until the old row dies of its own accord. To
   * change the TTL immediately, change the `sid` too — a new sid creates a new
   * row and takes effect on the next connection.
   */
  ttl?: number;
  /**
   * Pin every request to one endpoint — a specific modem (`port` / `device`)
   * or a Reserved IP lease (`lease`). Emits `-pin-<type>-<id>`; the gateway
   * consumes the next two parts. See {@link PinConfig} for the id rules
   * (they are validated at build time — an unresolvable pin does not error at
   * the gateway, it silently falls back to shared selection).
   */
  pin?: PinConfig;
  /**
   * Request the **strict** variant of endpoint pinning: emits the bare `strict`
   * token, e.g. `-rot-sticky-strict`.
   *
   * Not to be confused with {@link BuildProxyUrlOpts.failover} `'strict'` —
   * a different feature that emits `-failover-strict` and controls whether the
   * gateway may substitute another endpoint when the chosen one dies. The two
   * are independent and can be combined.
   *
   * What it does: the gateway applies a hard minimum IP-stability floor
   * (`ipStabilityScore >= 40`) and weights stability more heavily during
   * selection, so you land on the calmest modem available rather than merely a
   * healthy one. Because it narrows the candidate set, a thin country may
   * return "no endpoint" where a non-strict request would have succeeded.
   *
   * **Only honored under `rotation: 'sticky'` or `'hard'`** — the gateway gates
   * it behind pinning mode. {@link buildProxyUrl} silently omits the token for
   * every other rotation mode rather than emitting noise (or throwing: the SDK
   * is never stricter than the self-healing gateway parser).
   *
   * It does not change the stickiness contract: sticky pins the **modem**, not
   * the IP — mobile carrier CGNAT can still re-NAT the exit IP mid-session.
   * Strict buys you the modem with the calmest observed rotation history, not
   * an immutable IP. For an IP that must hold across a whole workflow, use a
   * `peer` residential endpoint or a Reserved IP lease ({@link PinConfig}).
   *
   * @since 0.10.0
   */
  strict?: boolean;
  /** Session ID — same sid → same endpoint (with `rotation: 'sticky'`). Keep stable per workflow. */
  sid?: string;
  /** Rotation policy. See {@link RotationMode}. */
  rotation?: RotationMode;
  /** Target pool. Defaults to `"mbl"`. */
  pool?: Pool;
  /** Transport. Defaults to `"http"` (port 7000). */
  protocol?: Protocol;
  /** Override the gateway host, for edge deployments or tests. */
  host?: string;
}

/**
 * Response from `GET /v1/gateway/pool/stock` (public-readable, optional auth).
 *
 * Shape verified against production 2026‑05‑01:
 *
 * ```json
 * {
 *   "pools": {
 *     "mbl":  { "us": 73, "gb": 22, "fr": 18, "nl": 15, "pl": 12, "ge": 9 },
 *     "peer": { "us": 0,  "ch": 1, ... }
 *   },
 *   "totals":     { "mbl": 149, "peer": 1, "all": 150 },
 *   "generatedAt": "2026-05-01T09:34:32.449Z"
 * }
 * ```
 *
 * **Country codes are dynamic.** Don't switch on a literal union — new
 * countries appear in this response without an SDK release. The SDK
 * runtime-validates that the envelope keys exist (`pools`, `totals`,
 * `generatedAt`) and throws a typed `ProxiesError` if upstream changes
 * the shape, but the per-country values are pass-through.
 *
 * @since 0.3.1 — earlier SDK versions declared `{ updatedAt, countries[] }`
 *   which never matched the running server. Fixed in 0.3.1 to mirror the
 *   live response.
 */
export interface PoolStock {
  /** Per-pool, per-country online endpoint count. Country code → online. */
  pools: {
    mbl: Record<string, number>;
    peer: Record<string, number>;
  };
  /** Aggregate totals across all countries. */
  totals: {
    mbl: number;
    peer: number;
    /** Sum of `mbl` + `peer`. */
    all: number;
  };
  /** ISO 8601 timestamp when the snapshot was taken (cached server-side ~30s). */
  generatedAt: string;
}

/** One carrier/ASN bucket of routable peer stock (counts only — never IPs). */
export interface CarrierStockEntry {
  /** Numeric ASN, or `null` if the AS number is unknown. Pass to {@link BuildProxyUrlOpts.asn}. */
  asn: number | null;
  /** Carrier/ISP display name, e.g. `"T-Mobile"`. Slugify for {@link BuildProxyUrlOpts.isp}. */
  name: string;
  /** Access type of this carrier's endpoints. */
  ipType: 'mobile' | 'residential' | 'datacenter' | string;
  /** Routable endpoints available right now for this carrier in the country. */
  count: number;
}

/**
 * Which pool's carrier breakdown to read.
 *
 * - `peer` (default) — the flagship fleet: a mix of `residential` and `mobile`
 *   carriers across every country with live stock.
 * - `mbl` — the carrier-modem tier. Every entry is `ipType: 'mobile'`, in the
 *   6 modem countries only.
 * - `all` — both, merged per country.
 *
 * @since 0.12.0
 */
export type CarrierStockPool = 'peer' | 'mbl' | 'all';

/** Per-country carrier bucket, as returned in the all-countries shape. */
export interface CarrierStockCountry {
  /** Total routable endpoints in the country across all carriers. */
  total: number;
  /** Endpoints whose ASN could not be named (bucketed out of `carriers`). */
  other: number;
  /** Named carriers, sorted by `count` desc. */
  carriers: CarrierStockEntry[];
}

/**
 * Live routable stock by carrier/ASN for ONE country. Returned by
 * {@link PoolApi.getCarrierStock} when a `country` is given.
 * Counts only — never exit IPs.
 *
 * @since 0.8.0
 */
export interface CarrierStock extends CarrierStockCountry {
  pool: CarrierStockPool;
  /** ISO 8601 timestamp when the snapshot was taken (cached server-side ~30s). */
  updatedAt: string;
  /** ISO 2-letter country this stock is for. */
  country: string;
}

/**
 * Live routable stock by carrier/ASN for EVERY country in one call — the full
 * catalogue. Returned by {@link PoolApi.getCarrierStock} when no `country` is
 * given. Counts only — never exit IPs.
 *
 * @since 0.12.0
 */
export interface CarrierStockAll {
  pool: CarrierStockPool;
  /** ISO 8601 timestamp when the snapshot was taken (cached server-side ~30s). */
  updatedAt: string;
  /** Keyed by ISO 2-letter country code, e.g. `countries.US`. */
  countries: Record<string, CarrierStockCountry>;
}

/**
 * One live gateway session for a customer. Returned by `client.sessions.list()`.
 *
 * @since 0.4.0
 */
export interface ActiveSession {
  /** Internal Redis key — used as the id when calling `sessions.close()`. */
  sessionKey: string;
  /** The accountId (proxyUsername) the session belongs to. */
  accountId: string;
  /**
   * Id of the Pool Access Key (`pak_`) that opened this session (absent for
   * non-pak sessions). In multi-tenant reseller setups this is the per-customer
   * ownership marker — matches a customer's `getUserKeyId`.
   */
  pakKeyId?: string;
  /**
   * The session id from the customer's `-sid-` token, or a synthesized
   * `auto_*` / `socks5_*` id for sessions created without an explicit sid.
   * Synthesized sessions get a 5-min TTL and are not meant to be reused.
   * Use `isSynthesizedSid` to filter them out of customer-facing UIs.
   */
  sessionId: string;
  /** Pool the session is routed through. `mbl` = mobile modems; `peer` = community SDK network (mobile + residential). */
  pool: Pool;
  /** ISO country code (lowercase). */
  country: string;
  /** Carrier name if known, `'N/A'` otherwise. */
  carrier: string;
  /** Last observed exit IP (updates as rotation fires). */
  currentIp: string;
  /** Unix ms when the session was first opened. */
  createdAt: number;
  /** Unix ms of the last observed activity. */
  lastActivityAt: number;
  /** Unix ms after which Redis evicts the session automatically. */
  expiresAt: number;
  /** Total requests proxied through this session so far. */
  requestCount: number;
  /** Total bytes received from the upstream. */
  bytesIn: number;
  /** Total bytes sent to the upstream. */
  bytesOut: number;
  /** Endpoint id this session is currently bound to. */
  endpointId: string;
  /** Rotation token from the username DSL. */
  rotation: RotationMode | string;
  /** Seconds until automatic eviction. Counts down each call. */
  ttl: number;
  /**
   * Customer-facing HTTP proxy URL with a `<PASSWORD>` placeholder.
   * Substitute with the user's `pak_` or `proxyPassword` client-side
   * before exposing or copying. Never write the substituted value to
   * server logs.
   */
  proxyUrl: string;
  /** Same shape as `proxyUrl` but `socks5://` and port 7001. */
  socks5Url: string;
  /**
   * `true` when the session id is synthesized (no `-sid-` was supplied).
   * Filter these out of customer-facing tables — they're internal and
   * have a short 5-min TTL.
   */
  isSynthesizedSid: boolean;
}

/** Response from `client.sessions.list()`. */
export interface ActiveSessionsResponse {
  sessions: ActiveSession[];
  count: number;
}

/** Incident notice (unauthenticated public endpoint). */
export interface Incident {
  id: string;
  severity: 'info' | 'minor' | 'major' | 'critical';
  title: string;
  description?: string;
  startedAt: string;
  resolvedAt?: string;
  affects: string[];
}

/**
 * Raw envelope returned by `GET /v1/gateway/incidents`.
 *
 * The live endpoint wraps the list in an object — it does NOT return a bare
 * array. {@link PoolApi.getIncidents} unwraps this to `incidents` so callers
 * still get an `Incident[]`.
 */
export interface IncidentsResponse {
  incidents: Incident[];
  /** ISO 8601 timestamp when the snapshot was generated (cached server-side ~60s). */
  generatedAt: string;
}

/**
 * Retry behavior for transient failures.
 *
 * Retries fire on `5xx` and `429` responses, on `ProxiesTimeoutError`,
 * and on network-level errors (`fetch` rejection). They do NOT fire on
 * `4xx` (other than `429`) — those are programmer errors. Each attempt
 * waits `min(maxDelayMs, baseDelayMs * 2^n)` plus full-jitter, unless the
 * server returned `Retry-After` (in which case the SDK honors that, capped
 * at `maxDelayMs`).
 *
 * @since 0.3.0
 */
export interface RetryConfig {
  /** Total attempts including the first. Default 3. Set to 1 to disable retries. */
  attempts?: number;
  /** Initial backoff in ms. Default 250. */
  baseDelayMs?: number;
  /** Cap on per-attempt sleep. Default 4000. */
  maxDelayMs?: number;
}

/** Constructor config for {@link ProxiesClient}. */
export interface ClientConfig {
  /**
   * Reseller API key (`psx_...`) — mint at https://client.proxies.sx/account
   * with scopes **`ports:read` + `ports:write`**.
   *
   * Not `customers:write`, which reads like the obvious choice and grants
   * nothing this SDK uses: the `/reseller/pool-keys/*` routes are gated by the
   * reseller *role* rather than by a scope, while the live-session routes
   * behind {@link ProxiesClient.sessions} do check scopes and `403` without
   * `ports:*`. Scope matching is exact-string or `prefix:*` wildcard — there
   * is no `customers` → `ports` mapping.
   *
   * Keep this server-side only; never expose to browsers.
   */
  apiKey: string;

  /**
   * Your reseller `proxyUsername` (e.g. `psx_abc123`). Required for
   * {@link ProxiesClient.buildProxyUrl} to construct the customer-facing
   * credential. Available in your Proxies.sx account settings.
   */
  proxyUsername?: string;

  /** Override the API base URL. Default: `https://api.proxies.sx/v1`. */
  baseUrl?: string;

  /** Override the gateway host used by `buildProxyUrl`. Default: `gw.proxies.sx`. */
  gatewayHost?: string;

  /** Request timeout in ms. Default: 30000. */
  timeout?: number;

  /**
   * Retry policy for transient failures (`5xx`, `429`, timeouts, network).
   *
   * - Pass `false` to disable.
   * - Pass an object to tune.
   * - Omit to use the default (3 attempts, 250ms / 1s / 4s + jitter).
   *
   * Retries are SDK-internal — the host app sees a single `await` either
   * resolving or rejecting after backoff is exhausted. Use the SDK's retry
   * by default and remove your own retry wrappers; combining the two
   * causes thundering-herd on transient gateway failures.
   *
   * @since 0.3.0
   */
  retry?: false | RetryConfig;

  /**
   * Custom fetch implementation (useful for Node < 18, edge runtimes, or mocking).
   * Defaults to global `fetch`.
   */
  fetch?: typeof fetch;
}

// ────────────────────────────────────────────────────────────────────────
//  Expiry helpers
// ────────────────────────────────────────────────────────────────────────

/**
 * `true` when the key has an `expiresAt` AND that moment has passed.
 * Returns `false` for keys with no expiry.
 *
 * Prefer the server-computed `key.isExpired` field when available — it
 * uses the platform's clock. This helper is for places where you only
 * have the raw `expiresAt` string.
 */
export function isPoolKeyExpired(
  keyOrExpiry: Pick<PoolAccessKey, 'expiresAt'> | string | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  const raw =
    typeof keyOrExpiry === 'string' || keyOrExpiry instanceof Date
      ? keyOrExpiry
      : keyOrExpiry?.expiresAt;
  if (!raw) return false;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(t) && t <= now;
}

/**
 * Days remaining until the key expires. Returns `null` if no expiry,
 * `0` when within the same day as expiry, negative numbers for already-
 * expired keys (so dashboards can show "expired 3 days ago" if you want).
 *
 * Uses `Math.ceil` so a key expiring in 1.2 days renders as "2 days remaining".
 */
export function daysUntilPoolKeyExpiry(
  keyOrExpiry: Pick<PoolAccessKey, 'expiresAt'> | string | Date | null | undefined,
  now: number = Date.now(),
): number | null {
  const raw =
    typeof keyOrExpiry === 'string' || keyOrExpiry instanceof Date
      ? keyOrExpiry
      : keyOrExpiry?.expiresAt;
  if (!raw) return null;
  const t = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now) / 86_400_000);
}
