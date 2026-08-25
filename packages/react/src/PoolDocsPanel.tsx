'use client';

import {
  type CSSProperties,
  type JSX,
  useState,
} from 'react';
import type { Branding, PoolPortalClassNames } from './types';

/**
 * Props for {@link PoolDocsPanel}.
 *
 * @public
 */
export interface PoolDocsPanelProps {
  /**
   * Reseller's `proxyUsername`. Inserted into the example curl so the
   * customer sees their actual identity, not a placeholder. Optional —
   * if omitted, a placeholder `<YOUR_USERNAME>` is rendered.
   */
  proxyUsername?: string;
  /**
   * Sample password to render in the example curl. Use a SAMPLE value
   * here — never the real `pak_`/proxy-password. The component intentionally
   * accepts a string to discourage rendering live secrets in docs panels.
   */
  exampleSamplePassword?: string;
  /** Gateway hostname. Default `gw.proxies.sx`. */
  gatewayHost?: string;
  /**
   * Which sections to render. Default: all four. Pass a subset to
   * compose smaller pieces.
   */
  sections?: ReadonlyArray<'how-it-works' | 'tokens' | 'rotation' | 'example'>;
  /** Branding (CSS custom properties). */
  branding?: Branding;
  /** Per-part className overrides. */
  classNames?: PoolPortalClassNames;
  /** Extra class on root. */
  className?: string;
  /** Inline style on root. */
  style?: CSSProperties;
}

const DEFAULT_SECTIONS = ['how-it-works', 'tokens', 'rotation', 'example'] as const;

/**
 * Drop-in technical reference panel for the Pool Gateway.
 *
 * Renders four collapsible sections:
 *
 * 1. **How it works** — diagram + prose explaining the request flow
 *    from customer → gateway → upstream device → exit IP.
 * 2. **Username token reference** — the full DSL grammar with descriptions
 *    of every required and optional token.
 * 3. **IP rotation modes** — the seven rotation tokens with behavior tables.
 * 4. **Example curl** — a copyable, syntax-highlighted curl that shows a
 *    named session on auto5 rotation.
 *
 * Self-contained — no backend calls. Pure presentational. Drop next
 * to {@link PoolSessionSpawner} or {@link ActiveSessionsTable} for a
 * full reseller dashboard with parity to `client.proxies.sx/pool-proxy`.
 *
 * @example
 * ```tsx
 * <PoolDocsPanel
 *   proxyUsername={me.proxyUsername}
 *   exampleSamplePassword="pak_xxxxxxxxxxxxxxxxxxxxxxxx"
 * />
 * ```
 *
 * @since 0.4.1
 * @public
 */
export function PoolDocsPanel(props: PoolDocsPanelProps): JSX.Element {
  const {
    proxyUsername = '<YOUR_USERNAME>',
    exampleSamplePassword = '<YOUR_PASSWORD>',
    gatewayHost = 'gw.proxies.sx',
    sections = DEFAULT_SECTIONS,
    branding,
    classNames = {},
    className,
    style,
  } = props;

  return (
    <div
      className={cn('psx', 'psx-docs', classNames.root, className)}
      style={brandingToStyle(branding, style)}
    >
      {sections.includes('how-it-works') && <HowItWorks classNames={classNames} />}
      {sections.includes('tokens') && <UsernameTokens classNames={classNames} />}
      {sections.includes('rotation') && <RotationModes classNames={classNames} />}
      {sections.includes('example') && (
        <ExampleCurl
          proxyUsername={proxyUsername}
          password={exampleSamplePassword}
          gatewayHost={gatewayHost}
          classNames={classNames}
        />
      )}
    </div>
  );
}

/* ── Section: How it works ────────────────────────────────────────────── */

function HowItWorks({ classNames }: { classNames: PoolPortalClassNames }): JSX.Element {
  return (
    <section className={cn('psx-docs-section', classNames.card)}>
      <h3 className="psx-docs-h3">How the Pool Gateway works</h3>
      <p className="psx-docs-p">
        Every request you send to <code>{`${'gw.proxies.sx'}:7000`}</code> (HTTP) or
        <code>{` ${'gw.proxies.sx'}:7001`}</code> (SOCKS5) is auth-checked, routed to
        a real mobile or residential device, and proxied to your target — typically
        in under 200 ms total.
      </p>

      <ol className="psx-docs-flow">
        <li>
          <span className="psx-docs-step-num">1</span>
          <div>
            <strong>Auth.</strong> The gateway parses your username (e.g.{' '}
            <code>psx_xxx-mbl-us-sid-bot07</code>) into routing tokens, then validates
            the password — either your proxy-password or a <code>pak_</code> access key.
            Cached for 30 s on success, 10 s on failure.
          </div>
        </li>
        <li>
          <span className="psx-docs-step-num">2</span>
          <div>
            <strong>Routing.</strong> The pool token (<code>mbl</code> = carrier
            modems in 6 countries, <code> peer</code> = the flagship network:
            mobile + residential across 80+ countries), country, optional
            carrier/city, and session id pick a candidate device from Redis.
            Sticky sessions keep you on the same device until TTL or rotation.
          </div>
        </li>
        <li>
          <span className="psx-docs-step-num">3</span>
          <div>
            <strong>Tunnel.</strong> Mobile traffic flows through a ProxySmart-managed
            modem; peer traffic flows through a relay-server WebSocket to a customer's
            phone running our SDK. Both expose a real carrier-grade exit IP — verifiable
            by ASN.
          </div>
        </li>
        <li>
          <span className="psx-docs-step-num">4</span>
          <div>
            <strong>Metering.</strong> Bytes are accounted per (account, session,
            endpoint) and flushed every 5 s. Your dashboard's traffic counter
            updates within ~5–15 s of any activity.
          </div>
        </li>
        <li>
          <span className="psx-docs-step-num">5</span>
          <div>
            <strong>Lifecycle.</strong> Sessions auto-expire on their TTL — 5 min
            for a connection with no <code>-sid-</code>, otherwise 1 h or whatever{' '}
            <code>-ttl-</code> you passed when the session row was first created
            (the TTL is fixed for the life of that row; changing the token on a live
            sid does nothing). Rotation mode does not affect it. Closing a session
            manually only releases the pinned device early.
          </div>
        </li>
      </ol>
    </section>
  );
}

/* ── Section: Username Token Reference ────────────────────────────────── */

function UsernameTokens({ classNames }: { classNames: PoolPortalClassNames }): JSX.Element {
  return (
    <section className={cn('psx-docs-section', classNames.card)}>
      <h3 className="psx-docs-h3">Username token reference</h3>
      <p className="psx-docs-p">
        Append tokens to your username with <code>-</code> separators to control
        routing per-request. The full username has the shape:
      </p>
      <pre className="psx-docs-code-block">
        {'<account>-<pool>-<country>[-sid-<id>][-rot-<mode>][-strict][-carrier-<name>][-city-<name>][-state-<name>][-iptype-<class>][-isp-<slug>][-asn-<n>][-failover-<policy>][-ttl-<seconds>][-pin-<type>-<id>]'}
      </pre>

      <h4 className="psx-docs-h4">Required</h4>
      <table className="psx-docs-table">
        <tbody>
          <tr>
            <td><code>-mbl-{'{country}'}</code></td>
            <td>
              Pool type + target country. Always required.
              <br />
              <span className="psx-docs-muted">
                mbl (production modems) countries: <code>us</code>,
                <code> gb</code>, <code>fr</code>, <code>nl</code>,
                <code> pl</code>, <code>ge</code>
              </span>
            </td>
          </tr>
          <tr>
            <td><code>-peer-{'{country}'}</code></td>
            <td>
              Use the peer network (the flagship pool — mobile + residential
              across 80+ countries) instead of mobile modems. Available stock
              varies; check <code>/stock</code>.
            </td>
          </tr>
        </tbody>
      </table>

      <h4 className="psx-docs-h4">Session control</h4>
      <table className="psx-docs-table">
        <tbody>
          <tr>
            <td><code>-sid-{'{id}'}</code></td>
            <td>
              Names the session. Requests carrying the same id land on the same
              device — <em>not</em> necessarily the same exit IP (see{' '}
              <code>-rot-</code> below).
              <br />
              <span className="psx-docs-muted">
                1–64 chars, <code>[a-z0-9_]</code>, self-healing. It takes ONE
                value, and the gateway splits the username on <code>-</code>, so a
                hyphenated id is truncated: <code>-sid-cust-11</code> is read as{' '}
                <code>cust</code> and the <code>11</code> is dropped. Use{' '}
                <code>cust_11</code>. Omit the token entirely for a fresh
                synthetic session per connection (5-min TTL).
              </span>
              <br />
              <span className="psx-docs-muted">
                A sid on its own is <strong>not</strong> sticky — with no{' '}
                <code>-rot-</code> the default <code>auto10</code> still re-picks a
                device every ~10 min. Pair it with <code>-rot-sticky</code>.
              </span>
              <br />
              <span className="psx-docs-muted">
                The token is <code>sid</code>, not <code>session</code>.{' '}
                <code>-session-{'<id>'}</code> is silently ignored (unknown
                token) so you get a fresh synthetic session per connection and no
                stickiness. Always use <code>-sid-{'<id>'}</code>.
              </span>
            </td>
          </tr>
          <tr>
            <td><code>-rot-{'{mode}'}</code></td>
            <td>
              How the gateway re-picks a device.{' '}
              <code>auto5</code> / <code>auto10</code> / <code>auto20</code> /{' '}
              <code>auto60</code> soft-rotate on that many minutes;{' '}
              <code>ondemand</code> re-picks only on a new connection;{' '}
              <code>sticky</code> pins the device for the session; <code>hard</code>{' '}
              behaves identically to <code>sticky</code>.
              <br />
              <span className="psx-docs-muted">
                <strong>Omitting the token is not "no rotation"</strong> — the
                gateway default is <code>auto10</code>, so a device change roughly
                every 10 minutes is what you get by saying nothing. An
                unrecognised mode also falls back to <code>auto10</code>, silently.
              </span>
              <br />
              <span className="psx-docs-muted">
                <code>sticky</code>/<code>auto*</code> only persist across
                connections when a <code>-sid-</code> is present — without one,
                every connection opens a fresh session and re-picks. Full behaviour
                table in the rotation section below.
              </span>
            </td>
          </tr>
          <tr>
            <td><code>-strict</code></td>
            <td>
              Modifier for <code>sticky</code>/<code>hard</code>: weights
              IP-stability much harder when picking the device, and never lets the
              gateway silently swap you onto a different one if it degrades
              mid-connection (it fails clean instead). Write it as{' '}
              <code>-rot-sticky-strict</code> — the username splits on{' '}
              <code>-</code>, so that reads as <code>rot=sticky</code> plus a bare{' '}
              <code>strict</code> token.
              <br />
              <span className="psx-docs-muted">
                A no-op for <code>auto*</code> and <code>ondemand</code>. It buys
                the longest-holding device we can find — still not an IP
                guarantee. Pairs best with the residential <code>peer</code> pool,
                where home-ISP IPs hold for hours rather than minutes.
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <h4 className="psx-docs-h4">Advanced</h4>
      <table className="psx-docs-table">
        <tbody>
          <tr>
            <td><code>-carrier-{'{name}'}</code></td>
            <td>
              Target a specific carrier — <code>att</code>, <code>tmobile</code>,
              <code> vodafone</code>, <code>orange</code>, <code>ee</code>,
              <code> telekom</code>, …
            </td>
          </tr>
          <tr>
            <td><code>-city-{'{name}'}</code></td>
            <td>City-level targeting where available. Falls back to country if no city match.</td>
          </tr>
          <tr>
            <td><code>-state-{'{name}'}</code></td>
            <td>
              US-state / region targeting (peer pool), e.g. <code>california</code>,{' '}
              <code>texas</code>, <code>new_york</code>. Soft like city: slugified to one
              token; on <code>mbl</code> the gateway has no region data and widens to the
              country rather than erroring.
            </td>
          </tr>
          <tr>
            <td><code>-iptype-{'{class}'}</code></td>
            <td>
              Hard IP-class filter: <code>mobile</code> / <code>residential</code> /{' '}
              <code>datacenter</code>. Restricts selection to that device class.
            </td>
          </tr>
          <tr>
            <td><code>-isp-{'{slug}'}</code></td>
            <td>
              Hard ISP match (peer pool) — slugified prefix match against the
              endpoint's ISP name, e.g. <code>-isp-spectrum</code>.
            </td>
          </tr>
          <tr>
            <td><code>-asn-{'{number}'}</code></td>
            <td>
              Hard exact ASN match (peer pool) — the most precise carrier filter,
              e.g. <code>-asn-7018</code>. Live stock: <code>/stock/carriers</code>.
            </td>
          </tr>
          <tr>
            <td><code>-pin-port-{'{id}'}</code></td>
            <td>
              Pin to a specific port (advanced — contact support for port ids).
            </td>
          </tr>
          <tr>
            <td><code>-pin-device-{'{id}'}</code></td>
            <td>
              Pin to a specific modem (advanced — contact support for device ids).
              Useful for compliance / forensic-traceability use cases.
            </td>
          </tr>
          <tr>
            <td><code>-failover-{'{policy}'}</code></td>
            <td>
              Failover behavior when the chosen endpoint goes offline.{' '}
              <code>any</code> / <code>samecountry</code> (default) /{' '}
              <code>samecarrier</code> / <code>samenode</code> / <code>strict</code>.
            </td>
          </tr>
          <tr>
            <td><code>-ttl-{'{seconds}'}</code></td>
            <td>
              Session TTL override. 60 – 2 592 000 seconds (out-of-range values are
              clamped). Default 3600 (1 h).
              <br />
              <span className="psx-docs-muted">
                Fixed when the session row is created: each request re-expires the row
                using the STORED value, so changing <code>-ttl-</code> on a live{' '}
                <code>-sid-</code> is a no-op until that session dies. Use a new sid.
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/* ── Section: Rotation Modes ──────────────────────────────────────────── */

function RotationModes({ classNames }: { classNames: PoolPortalClassNames }): JSX.Element {
  const rows: Array<{ token: string; interval: string; behavior: string; defaultMark?: boolean }> = [
    { token: '-rot-auto5', interval: '5 min', behavior: 'Soft rotation: re-pick a different device every 5 minutes.' },
    { token: '-rot-auto10', interval: '10 min', behavior: 'Soft rotation every 10 minutes. Applied whenever no -rot- token is present.', defaultMark: true },
    { token: '-rot-auto20', interval: '20 min', behavior: 'Soft rotation every 20 minutes.' },
    { token: '-rot-auto60', interval: '60 min', behavior: 'Soft rotation every 60 minutes.' },
    {
      token: '-rot-sticky',
      interval: '—',
      behavior:
        'Pin to one device for the full session. The gateway smart-selects the most IP-stable device in the country (mobile carriers vary widely in CGNAT aggressiveness; we pick the one whose IP holds longest). NOTE: the IP itself can still change inside the carrier\'s CGNAT pool — sticky pins the DEVICE, not the IP. Append -strict (i.e. -rot-sticky-strict) to weight stability harder still.',
    },
    {
      token: '-rot-hard',
      interval: '—',
      behavior:
        'Identical to sticky at routing time — it pins the device for the session. The name misleads: it does NOT give a new IP per request, and a fresh TCP connection does NOT pick a different device. A true carrier-IP reset happens only through an explicit rotate action on a dedicated port, and is a no-op for peers. Prefer -rot-sticky; hard exists for backwards compatibility.',
    },
    { token: '-rot-ondemand', interval: '—', behavior: 'No auto-rotate timer: re-pick only when a new connection opens. Not the default — omitting -rot- gives auto10.' },
  ];

  return (
    <section className={cn('psx-docs-section', classNames.card)}>
      <h3 className="psx-docs-h3">IP rotation modes</h3>
      <p className="psx-docs-p">
        Rotation tokens control how the gateway selects endpoints. The interval
        column is how often a soft rotation re-picks a device — it is <em>not</em>{' '}
        the session TTL, which is a separate token (<code>-ttl-</code>, default
        1 h with a <code>-sid-</code>, 5 min for a connection without one).{' '}
        <strong>Every mode needs a <code>-sid-</code></strong> to persist across
        connections; without one each connection starts a fresh session and
        re-picks.{' '}
        <strong>For sticky/hard:</strong> the gateway pins the DEVICE, not the
        IP — mobile carriers can rotate egress IPs out of CGNAT pools even while
        the device connection is held. We compensate by smart-selecting the
        most IP-stable device in your country. See the wiki page{' '}
        <a
          href="https://github.com/bolivian-peru/proxy-reseller-kit/wiki/Sticky-Sessions-and-Rotation"
          target="_blank"
          rel="noreferrer"
          className="psx-docs-link"
        >
          Sticky Sessions and Rotation
        </a>{' '}
        for the full Layer-1-vs-Layer-2 explanation.
      </p>
      <table className="psx-docs-table">
        <thead>
          <tr>
            <th>Token</th>
            <th>Rotation interval</th>
            <th>Behavior</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.token}>
              <td>
                <code>{r.token}</code>
                {r.defaultMark && <span className="psx-docs-default-pill">default</span>}
              </td>
              <td>{r.interval}</td>
              <td>{r.behavior}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ── Section: Example Curl ────────────────────────────────────────────── */

function ExampleCurl(props: {
  proxyUsername: string;
  password: string;
  gatewayHost: string;
  classNames: PoolPortalClassNames;
}): JSX.Element {
  const { proxyUsername, password, gatewayHost, classNames } = props;
  const [copied, setCopied] = useState(false);
  const example = `curl -x http://${proxyUsername}-mbl-us-sid-scraper01-rot-auto5:${password}@${gatewayHost}:7000 https://httpbin.org/ip`;

  const handleCopy = (): void => {
    void navigator.clipboard?.writeText(example);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className={cn('psx-docs-section', classNames.card)}>
      <h3 className="psx-docs-h3">Example: US proxy, named session, new device every 5 min</h3>
      <div className="psx-docs-curl-wrap">
        <pre className="psx-docs-code-block psx-docs-curl">{example}</pre>
        <button
          type="button"
          onClick={handleCopy}
          className={cn('psx-button', 'psx-button-ghost', classNames.button)}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="psx-docs-p psx-docs-muted">
        The <code>pak_</code> key goes in the <strong>password</strong> position, never
        in the username — the gateway resolves the account from the first username
        segment alone, so a <code>pak_</code> there is an unconditional 407. Swap{' '}
        <code>-rot-auto5</code> for <code>-rot-sticky</code> to hold the device instead
        of rotating. The username carries all routing — <strong>no API call needed</strong>{' '}
        to change country, rotation, or session id.
      </p>
    </section>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

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
