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
 * 3. **IP rotation modes** — the six rotation tokens with behavior tables.
 * 4. **Example curl** — a copyable, syntax-highlighted curl that shows
 *    sticky sessions + auto5 rotation.
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
            <strong>Routing.</strong> The pool token (<code>mbl</code> = mobile,
            <code> peer</code> = residential), country, optional carrier/city, and
            session id pick a candidate device from Redis. Sticky sessions keep
            you on the same device until TTL or rotation.
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
            <strong>Lifecycle.</strong> Sessions auto-expire on their TTL (5 min
            for connections without an explicit <code>-sid-</code>; 1 h with a sid
            and <code>sticky</code> rotation). Closing a session manually only
            releases the pinned IP early.
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
        {'<account>-<pool>-<country>[-sid-<id>][-rot-<mode>][-carrier-<name>][-city-<name>]'}
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
                Available: <code>us</code>, <code>de</code>, <code>gb</code>,
                <code> es</code>, <code>fr</code>, <code>pl</code>
              </span>
            </td>
          </tr>
          <tr>
            <td><code>-peer-{'{country}'}</code></td>
            <td>
              Use the residential peer pool instead of mobile. Same country
              codes. Available stock varies; check <code>/stock</code>.
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
              Sticky session — requests with the same id exit from the same
              device & IP.
              <br />
              <span className="psx-docs-muted">
                8–64 alphanumeric chars. Different ids → different IPs. Omit for
                a fresh device per connection (5-min TTL).
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
            <td>Session TTL override. 60 – 86 400 seconds. Default 3600 (1 h).</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/* ── Section: Rotation Modes ──────────────────────────────────────────── */

function RotationModes({ classNames }: { classNames: PoolPortalClassNames }): JSX.Element {
  const rows: Array<{ token: string; ttl: string; behavior: string; defaultMark?: boolean }> = [
    { token: '-rot-auto5', ttl: '5 min', behavior: 'New modem every 5 minutes (soft rotation: pick different endpoint).' },
    { token: '-rot-auto10', ttl: '10 min', behavior: 'New modem every 10 minutes.', defaultMark: true },
    { token: '-rot-auto20', ttl: '20 min', behavior: 'New modem every 20 minutes.' },
    { token: '-rot-auto60', ttl: '60 min', behavior: 'New modem every 60 minutes.' },
    {
      token: '-rot-sticky',
      ttl: '1 h',
      behavior:
        'Pin to one modem for the full session. The gateway smart-selects the most IP-stable modem in the country (mobile carriers vary widely in CGNAT aggressiveness; we pick the one whose IP holds longest). NOTE: the IP itself can still change inside the carrier\'s CGNAT pool — sticky pins the MODEM, not the IP.',
    },
    {
      token: '-rot-hard',
      ttl: 'per-conn',
      behavior:
        'Pin a modem per session like sticky, but a fresh TCP connection from your client picks a different modem. Useful for parallel workers that each want their own stable modem.',
    },
    { token: '-rot-ondemand', ttl: 'per-conn', behavior: 'Default behavior with no auto-rotate timer (reuses while connected).' },
  ];

  return (
    <section className={cn('psx-docs-section', classNames.card)}>
      <h3 className="psx-docs-h3">IP rotation modes</h3>
      <p className="psx-docs-p">
        Rotation tokens control how the gateway selects endpoints. The TTL
        column is what the gateway evicts the session at; manual close is only
        needed if you want the IP released earlier.{' '}
        <strong>For sticky/hard:</strong> the gateway pins the MODEM, not the
        IP — mobile carriers can rotate egress IPs out of CGNAT pools even while
        the modem connection is held. We compensate by smart-selecting the
        most IP-stable modem in your country. See the wiki page{' '}
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
            <th>Session TTL</th>
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
              <td>{r.ttl}</td>
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
      <h3 className="psx-docs-h3">Example: US proxy with sticky session, rotating every 5 min</h3>
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
        Replace the password with your actual <code>pak_</code> key or proxy-password.
        The username carries all routing — <strong>no API call needed</strong> to
        change country, rotation, or session id.
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
