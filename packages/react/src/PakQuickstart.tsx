'use client';

/**
 * PakQuickstart — the 30-second "your customer just got a pak, what now?" card.
 *
 * Drop this component next to the customer's pak display in your portal.
 * It renders a compact, copy-paste-ready quickstart that turns a confused
 * "I have pak_xxx, what now?" into a working curl in 60 seconds.
 *
 * Why this exists separate from PoolDocsPanel:
 *   - PoolDocsPanel (4 sections, ~360 lines of UI) is for power users.
 *   - PakQuickstart is for the 80% of customers who got their first pak
 *     and don't know the username format `pak_xxx-mbl-COUNTRY`. Without
 *     it, they 407 once and give up. That's the conversion problem.
 *
 * Anti-pattern: rendering the live secret as plaintext on a long-lived
 * page. Use `secretDisplay='masked'` (default) and a Reveal button. Only
 * pass `secret` if you've gated the page behind fresh auth.
 *
 * @public
 */

import { type CSSProperties, type JSX, useState } from 'react';
import type { Branding, PoolPortalClassNames } from './types';

const COUNTRIES = [
  { code: 'us', name: 'United States' },
  { code: 'de', name: 'Germany' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'fr', name: 'France' },
  { code: 'es', name: 'Spain' },
  { code: 'pl', name: 'Poland' },
] as const;

/**
 * Props for {@link PakQuickstart}.
 * @public
 */
export interface PakQuickstartProps {
  /** The customer's pak_ key. Required — the whole point is showing them their actual key. */
  pak: string;
  /**
   * The secret password matched to the pak. Optional.
   *   - omit → renders `<YOUR_PASSWORD>` placeholder (safest default)
   *   - provide → renders the actual password (only if your page is fresh-auth gated)
   */
  secret?: string;
  /** Mask mode. Default 'masked' shows last-4 with reveal button. */
  secretDisplay?: 'masked' | 'plain';
  /** Default country dropdown selection. Default 'us'. */
  defaultCountry?: 'us' | 'de' | 'gb' | 'fr' | 'es' | 'pl';
  /** Gateway hostname. Default `gw.proxies.sx`. Override for self-hosted gateways. */
  gatewayHost?: string;
  /** Cap and used GB, for the meter. Pass null/undefined to hide. */
  capGB?: number;
  usedGB?: number;
  /** Branding (CSS custom properties). */
  branding?: Branding;
  /** Per-part className overrides. */
  classNames?: PoolPortalClassNames;
  /** Extra class on root. */
  className?: string;
  /** Inline style on root. */
  style?: CSSProperties;
  /**
   * Hide the troubleshooting expander. Default false (show it).
   * Set to true if you have your own support flow elsewhere on the page.
   */
  hideTroubleshooting?: boolean;
}

function brandingToVars(branding?: Branding): CSSProperties {
  if (!branding) return {};
  const vars: Record<string, string> = {};
  if (branding.primaryColor) vars['--pp-primary'] = branding.primaryColor;
  if (branding.accentColor)  vars['--pp-accent']  = branding.accentColor;
  if (branding.fontFamily)   vars['--pp-font']    = branding.fontFamily;
  if (branding.radius)       vars['--pp-radius']  = branding.radius;
  return vars as CSSProperties;
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••••••';
  return secret.slice(0, 4) + '…' + secret.slice(-4);
}

/**
 * The 30-second quickstart card.
 *
 * @public
 */
export function PakQuickstart(props: PakQuickstartProps): JSX.Element {
  const {
    pak,
    secret,
    secretDisplay = 'masked',
    defaultCountry = 'us',
    gatewayHost = 'gw.proxies.sx',
    capGB,
    usedGB,
    branding,
    classNames,
    className,
    style,
    hideTroubleshooting = false,
  } = props;

  const [country, setCountry] = useState<string>(defaultCountry);
  const [sticky, setSticky] = useState(false);
  const [stickyId, setStickyId] = useState('myproject');
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const pwForUrl = secret && (revealed || secretDisplay === 'plain') ? secret : 'YOUR_PASSWORD';
  const pwForDisplay = secret
    ? revealed || secretDisplay === 'plain'
      ? secret
      : maskSecret(secret)
    : 'YOUR_PASSWORD';

  const username = sticky ? `${pak}-mbl-${country}-sid-${stickyId}` : `${pak}-mbl-${country}`;
  const httpUrl = `http://${username}:${pwForUrl}@${gatewayHost}:7000`;
  const socksUrl = `socks5://${username}:${pwForUrl}@${gatewayHost}:7001`;
  const curlCmd = `curl -x ${httpUrl} https://api.ipify.org`;
  const pythonSnippet = `proxies = {
  "http":  "${httpUrl}",
  "https": "${httpUrl}",
}
import requests
print(requests.get("https://api.ipify.org", proxies=proxies).text)`;
  const nodeSnippet = `import { fetch, ProxyAgent } from 'undici';
const dispatcher = new ProxyAgent('${httpUrl}');
const r = await fetch('https://api.ipify.org', { dispatcher });
console.log(await r.text());`;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const usedPct = capGB && capGB > 0 ? Math.min(100, Math.round(((usedGB ?? 0) / capGB) * 100)) : null;

  return (
    <section
      className={['pp-pakquick', className].filter(Boolean).join(' ')}
      style={{ ...brandingToVars(branding), ...style }}
    >
      <header className={classNames?.header ?? 'pp-pakquick__header'}>
        <h2 className="pp-pakquick__title">Use your proxy in 30 seconds</h2>
        <p className="pp-pakquick__lead">
          Real 4G/5G mobile IPs from real phones. Plug the credentials below into any HTTP client.
        </p>
      </header>

      {/* Credentials block */}
      <div className="pp-pakquick__creds">
        <div className="pp-pakquick__row">
          <span className="pp-pakquick__label">Access key</span>
          <code className="pp-pakquick__mono">{pak}</code>
          <button className="pp-pakquick__btn-link" onClick={() => copy(pak, 'pak')}>
            {copiedKey === 'pak' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="pp-pakquick__row">
          <span className="pp-pakquick__label">Password</span>
          <code className="pp-pakquick__mono">{pwForDisplay}</code>
          {secret && secretDisplay === 'masked' && (
            <button className="pp-pakquick__btn-link" onClick={() => setRevealed(v => !v)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
          )}
          {secret && (
            <button className="pp-pakquick__btn-link" onClick={() => copy(secret, 'pw')}>
              {copiedKey === 'pw' ? 'Copied' : 'Copy'}
            </button>
          )}
        </div>
      </div>

      {/* Cap meter */}
      {usedPct !== null && (
        <div className="pp-pakquick__meter">
          <div className="pp-pakquick__meter-row">
            <span>Traffic</span>
            <span>
              {(usedGB ?? 0).toFixed(2)} GB / {capGB?.toFixed(2)} GB
            </span>
          </div>
          <div className="pp-pakquick__meter-bar">
            <div className="pp-pakquick__meter-fill" style={{ width: `${usedPct}%` }} />
          </div>
        </div>
      )}

      {/* Picker controls */}
      <div className="pp-pakquick__controls">
        <label className="pp-pakquick__field">
          <span>Country</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>{c.name} ({c.code.toUpperCase()})</option>
            ))}
          </select>
        </label>
        <label className="pp-pakquick__field pp-pakquick__field--check">
          <input type="checkbox" checked={sticky} onChange={(e) => setSticky(e.target.checked)} />
          <span>Sticky session (same IP across requests)</span>
        </label>
        {sticky && (
          <label className="pp-pakquick__field">
            <span>Session ID</span>
            <input
              type="text"
              value={stickyId}
              maxLength={32}
              onChange={(e) => setStickyId(e.target.value.replace(/[^a-z0-9_-]/gi, '').slice(0, 32) || 'myproject')}
            />
          </label>
        )}
      </div>

      {/* Curl block */}
      <div className="pp-pakquick__example">
        <div className="pp-pakquick__example-head">
          <span>Try it (Bash / curl)</span>
          <button className="pp-pakquick__btn" onClick={() => copy(curlCmd, 'curl')}>
            {copiedKey === 'curl' ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="pp-pakquick__pre">{curlCmd}</pre>
      </div>

      {/* Code samples — collapsible */}
      <details className="pp-pakquick__details">
        <summary>Use it in code (Python / Node.js / Playwright)</summary>
        <div className="pp-pakquick__example">
          <div className="pp-pakquick__example-head">
            <span>Python (requests)</span>
            <button className="pp-pakquick__btn" onClick={() => copy(pythonSnippet, 'py')}>
              {copiedKey === 'py' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="pp-pakquick__pre">{pythonSnippet}</pre>
        </div>
        <div className="pp-pakquick__example">
          <div className="pp-pakquick__example-head">
            <span>Node.js (undici)</span>
            <button className="pp-pakquick__btn" onClick={() => copy(nodeSnippet, 'node')}>
              {copiedKey === 'node' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="pp-pakquick__pre">{nodeSnippet}</pre>
        </div>
      </details>

      {/* SOCKS5 mini-section */}
      <details className="pp-pakquick__details">
        <summary>SOCKS5 instead of HTTP</summary>
        <p className="pp-pakquick__hint">
          Same credentials, port 7001, prefix <code>socks5://</code>:
        </p>
        <div className="pp-pakquick__example">
          <div className="pp-pakquick__example-head">
            <span>SOCKS5 connection string</span>
            <button className="pp-pakquick__btn" onClick={() => copy(socksUrl, 'socks')}>
              {copiedKey === 'socks' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="pp-pakquick__pre">{socksUrl}</pre>
        </div>
      </details>

      {/* Troubleshooting */}
      {!hideTroubleshooting && (
        <details className="pp-pakquick__details">
          <summary>Troubleshooting</summary>
          <table className="pp-pakquick__table">
            <thead>
              <tr><th>Problem</th><th>Fix</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>407 Proxy Authentication Required</code></td>
                <td>Wrong key/password — check the username includes <code>-mbl-{country}</code> (without it, auth fails). Or you hit your traffic cap.</td>
              </tr>
              <tr>
                <td><code>502 Bad Gateway</code></td>
                <td>No device available for that country right now. Try another country or wait 30s.</td>
              </tr>
              <tr>
                <td>Same IP every time, wanted rotation</td>
                <td>Remove <code>-sid-X</code> from the username (uncheck "Sticky session" above).</td>
              </tr>
              <tr>
                <td>Different IP every request, wanted sticky</td>
                <td>Check "Sticky session" and use the same session ID for related requests.</td>
              </tr>
              <tr>
                <td>Slow / timeouts</td>
                <td>Test first with <code>https://api.ipify.org</code>. If that works, the proxy is fine and the target site is slow.</td>
              </tr>
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}
