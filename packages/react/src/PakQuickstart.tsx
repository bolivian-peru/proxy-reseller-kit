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
 *     and don't know which half of the credential it is. Without it, they
 *     407 once and give up. That's the conversion problem.
 *
 * THE CREDENTIAL MODEL — get this wrong and every request 407s:
 *
 *   username = <proxyUsername>-<pool>-<country>[-sid-…][-rot-…]
 *   password = the pak_ key   (or the account's proxy-password)
 *
 * The gateway resolves the account from the FIRST username segment only,
 * matching it against `users.proxyUsername`, `psx_<userId>`, or the account
 * email. A `pak_…` in the username position matches none of those, and the
 * username parser is self-healing — it accepts the string without a single
 * correction — so the only symptom is a 407 with no explanation. That is why
 * `proxyUsername` is a required prop rather than an optional one.
 *
 * Anti-pattern: rendering the live password as plaintext on a long-lived
 * page. Use `secretDisplay='masked'` (default) and a Reveal button. Only
 * switch to `'plain'` if you've gated the page behind fresh auth.
 *
 * @public
 */

import { type CSSProperties, type JSX, useState } from 'react';
import type { Branding, PoolPortalClassNames } from './types';

const COUNTRIES = [
  { code: 'us', name: 'United States' },
  { code: 'gb', name: 'United Kingdom' },
  { code: 'fr', name: 'France' },
  { code: 'nl', name: 'Netherlands' },
  { code: 'pl', name: 'Poland' },
  { code: 'ge', name: 'Georgia' },
] as const;

/**
 * Props for {@link PakQuickstart}.
 * @public
 */
export interface PakQuickstartProps {
  /**
   * The account identity that goes in the USERNAME position — your reseller
   * `proxyUsername` (`psx_…`), or the end-account's own `proxyUsername` if you
   * mint keys per sub-account.
   *
   * Required, and deliberately so: the gateway resolves the account from this
   * segment alone (`users.proxyUsername` → `psx_<userId>` → account email). A
   * `pak_…` here matches none of them and every request 407s, silently — the
   * username parser self-heals, so it reports no error to correct against.
   */
  proxyUsername: string;
  /**
   * The customer's pak_ key. This is the PASSWORD, not the username — the
   * whole point is showing them their actual credential in the right slot.
   */
  pak: string;
  /**
   * Override the password. Only needed when the customer authenticates with an
   * account proxy-password instead of a `pak_` key; otherwise leave it unset and
   * the `pak` is used, which is what the gateway expects.
   */
  secret?: string;
  /**
   * Mask mode for the password. Default 'masked' shows a truncated value plus a
   * Reveal button, and keeps the real secret out of the copyable strings until
   * the customer asks for it.
   */
  secretDisplay?: 'masked' | 'plain';
  /** Default country dropdown selection. Default 'us'. */
  defaultCountry?: 'us' | 'gb' | 'fr' | 'nl' | 'pl' | 'ge';
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
    proxyUsername,
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

  // The pak_ IS the password. `secret` only overrides it for an account that
  // authenticates with a proxy-password instead of a key.
  const password = secret ?? pak;
  const passwordVisible = revealed || secretDisplay === 'plain';
  // Keep the live credential out of the copyable blocks until it is explicitly
  // revealed — these get pasted into chats, screenshots, and support tickets.
  const pwForUrl = passwordVisible ? password : 'YOUR_PASSWORD';
  const pwForDisplay = passwordVisible ? password : maskSecret(password);

  // Username = account identity + routing tokens. The pak_ never appears here:
  // the gateway resolves the account from this first segment only, so a pak_ in
  // this position is an unconditional 407.
  //
  // Sticky needs BOTH tokens. `-sid-` names the session so it survives across
  // connections; `-rot-sticky` overrides the gateway's default rotation
  // (`auto10`), which would otherwise re-pick a device every ~10 minutes even
  // with a sid present.
  const username = sticky
    ? `${proxyUsername}-mbl-${country}-sid-${stickyId}-rot-sticky`
    : `${proxyUsername}-mbl-${country}`;
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

      {/* Credentials block. Two rows on purpose: which half is which is the
          single thing customers get wrong, and it costs them a silent 407. */}
      <div className="pp-pakquick__creds">
        <div className="pp-pakquick__row">
          <span className="pp-pakquick__label">Username</span>
          <code className="pp-pakquick__mono">{username}</code>
          <button className="pp-pakquick__btn-link" onClick={() => copy(username, 'user')}>
            {copiedKey === 'user' ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="pp-pakquick__row">
          <span className="pp-pakquick__label">Password</span>
          <code className="pp-pakquick__mono">{pwForDisplay}</code>
          {secretDisplay === 'masked' && (
            <button className="pp-pakquick__btn-link" onClick={() => setRevealed(v => !v)}>
              {revealed ? 'Hide' : 'Reveal'}
            </button>
          )}
          <button className="pp-pakquick__btn-link" onClick={() => copy(password, 'pw')}>
            {copiedKey === 'pw' ? 'Copied' : 'Copy'}
          </button>
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
          <span>Sticky session (same device)</span>
        </label>
        {sticky && (
          <label className="pp-pakquick__field">
            <span>Session ID</span>
            <input
              type="text"
              value={stickyId}
              maxLength={32}
              // The gateway lowercases the username and keeps only [a-z0-9_]
              // per token, so normalise here — what's on screen is then exactly
              // what the gateway routes on.
              onChange={(e) => setStickyId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'myproject')}
            />
          </label>
        )}
      </div>

      {sticky && (
        <p className="pp-pakquick__hint">
          Sticky pins the <strong>device</strong> for this session id, not the exit IP —
          mobile carriers can re-issue a NAT address on their own schedule. Reuse the same
          session ID for requests that belong together.
        </p>
      )}

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
                <td>
                  The two halves are swapped. The username is your account id plus
                  routing tokens (<code>{username}</code>); the <code>pak_</code> key is
                  the <em>password</em>. A <code>pak_</code> in the username position
                  always fails — the gateway looks the account up by that first segment
                  only. Otherwise: the key is disabled, expired, or over its traffic cap.
                </td>
              </tr>
              <tr>
                <td><code>502 Bad Gateway</code></td>
                <td>No device available for that country right now. Try another country or wait 30s.</td>
              </tr>
              <tr>
                <td>Device changes every ~10 minutes</td>
                <td>
                  That is the gateway default (<code>auto10</code>) — it applies whenever the
                  username carries no <code>-rot-</code> token. Tick "Sticky session" above;
                  it emits both <code>-sid-</code> and <code>-rot-sticky</code>, and you need
                  both for a session to hold.
                </td>
              </tr>
              <tr>
                <td>Exit IP changed while sticky was on</td>
                <td>
                  Expected. Sticky holds the device; the carrier can still re-NAT the exit IP
                  underneath it. If a workflow needs one IP end-to-end (cookies, 2FA), ask us
                  about a Reserved IP lease or a dedicated modem — no pool rotation mode can
                  promise that.
                </td>
              </tr>
              <tr>
                <td>Want a fresh device more often</td>
                <td>
                  Leave "Sticky session" off for the default 10-minute turnover, or append
                  <code> -rot-auto5</code> to the username yourself for 5-minute turnover.
                  Every routing choice lives in the username — nothing to configure here.
                </td>
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
