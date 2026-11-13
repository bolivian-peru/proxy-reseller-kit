# Reseller integration check and questionnaire

Use this file in two ways:

1. **Section A** is a prompt for your engineering team or your AI coding agent. It audits
   your integration against how the gateway behaves today.
2. **Section B** is a questionnaire. Have your agent answer it from your own code, configs
   and logs, and send the answers to your Proxies.sx contact. We use them to tune routing,
   pools and anti-detection settings for your traffic.

Checked against the live gateway on 13 November 2026 (release `949b4484d`).

---

## A. Prompt for your engineering team or AI agent

```
Read https://github.com/bolivian-peru/proxy-reseller-kit (README "Pricing at a glance" and
"Refusals and retries", docs/USERNAME-DSL.md, docs/WHITE-LABEL.md,
docs/POOL-PROXY-WORKSPACE.md) and audit our reseller integration against it. For every
item report PASS / FAIL / N/A with the file and line, and fix every FAIL.

Endpoint and DNS
1. Our proxy hostname is an A record (DNS only, no CDN proxying) to the white-label edge
   address we were given, not a CNAME to gw.proxies.sx. HTTP is port 7000, SOCKS5 is 7001.
2. No customer-visible text, header, certificate or URL in our product names the platform.

Credentials and usernames
3. Usernames follow docs/USERNAME-DSL.md: <login>-<pool>-<country>[-tokens].
   Lowercase, split on "-", so no token value contains "-".
4. Sticky sessions use -sid-<id>. The token -session- is ignored. A sticky mobile session
   pins the modem, not the IP (carriers re-NAT); a held IP needs residential or a lease.
5. -rot-ondemand with -sid- gives a new exit on every new connection; sticky/hard keep it.
6. Each end customer has their own pak_ key with a GB cap; keys are never shared between
   customers and never shipped to a browser.

Anti-detection on the client side (our responsibility)
7. SOCKS5 clients resolve DNS remotely (socks5h:// or the tool's "remote DNS" option).
   Local resolution leaks the customer's own resolver and is the most common detection
   signal we see. For HTTP, use CONNECT with the hostname, never a pre-resolved IP.
8. Our own relay or proxy in front of the gateway (if any) adds no Via, X-Forwarded-For,
   Forwarded, X-Real-IP or Proxy-* headers and does not rewrite TLS (no MITM).
9. Browser/automation profiles match the exit: timezone, locale/Accept-Language and
   geolocation set to the exit country; WebRTC disabled or forced through the proxy;
   IPv6 disabled in the client when the exit is IPv4 only.
10. One profile maps to one -sid-; we do not reuse a sid across unrelated profiles.
11. Request pacing is per sid and per target; no burst of parallel logins from one exit.

Errors and stock
12. Every refusal is mapped to a clear message: read the X-Proxies-Error-Code response
    header (HTTP) or the E_* code at the start of the body; SOCKS5 maps the reply code.
13. On a refusal we back off: honour Retry-After (30 s on E_NO_STOCK_COUNTRY) and never
    retry the same refused request in a tight loop (the gateway answers repeats from
    memory for a few seconds after 10 identical refusals in a minute).
14. Country lists, stock counts and prices are read from
    GET https://api.proxies.sx/v1/gateway/pool/stock (pricing.tiers, volumeDiscounts), never
    hardcoded; zero and unknown are shown differently.

Output: a table of the 14 checks, the fixes made (diffs), and anything we could not verify.
Then answer docs/RESELLER-INTEGRATION-QUESTIONNAIRE.md section B from our code, configs and
logs, and return the answers as markdown.
```

---

## B. Questionnaire (answer and send back)

Answer from real code, configs and logs. Write "unknown" rather than guess. Never include
passwords, pak_ keys or customer personal data.

**1. Traffic and targets**
1.1 Top 10 target sites or site types your customers use (e.g. social, marketplaces, search,
    ad verification, sneaker, ticketing), with a rough share of traffic each.
1.2 Monthly GB now and expected in 3 months, per country.
1.3 Split between residential (peer), mobile (mbl) and Private modems today.
1.4 Which targets have blocked, challenged or flagged your customers in the last 30 days?
    For each: the site, the signal shown (CAPTCHA, 403, "unusual traffic", account lock),
    the pool and country, and roughly how often.

**2. Clients and tools**
2.1 Which clients send traffic: antidetect browsers (which), Puppeteer/Playwright/Selenium,
    custom HTTP libraries (language and library), mobile apps, scrapers?
2.2 HTTP or SOCKS5 per client. For SOCKS5: is DNS resolved remotely (socks5h)?
2.3 Do any clients pin TLS/JA3/JA4 fingerprints or HTTP/2 settings? Which values?
2.4 Do clients send IPv6 traffic, or is IPv6 disabled?
2.5 How are timezone, locale and WebRTC handled per profile?

**3. Your infrastructure**
3.1 Do customers connect to our edge directly, or through your own relay, load balancer or
    proxy first? If through yours: software and version, and whether it adds or strips any
    headers or terminates TLS.
3.2 Which hostname(s) do customers use, and how are they resolved (A record target, TTL)?
3.3 How do you mint and assign pak_ keys (per customer, per order, per profile)? Caps used?
3.4 How do you build usernames (code location)? Which tokens do you use?

**4. Sessions and rotation**
4.1 Typical session pattern per use case: how long must one IP hold, how many requests per
    session, how many parallel sessions per customer?
4.2 Which rotation modes do you use (sticky, ondemand, auto5/10/20/60, hard)?
4.3 Do you need the same exit across separate connections for hours (account work)? Which
    countries?
4.4 Do you need city, state, carrier, ASN or ISP targeting? Where?

**5. Errors and monitoring**
5.1 Which E_* codes did you see most in the last 7 days, and how does your product react?
5.2 How do you retry after a refusal (delay, max attempts)?
5.3 What do you monitor (success rate per target, latency, bytes), and can you share a 7-day
    summary per pool and country?

**6. Requests to us**
6.1 Countries or carriers you need that we do not stock enough of.
6.2 Anything on the edge or in responses that still identifies the platform.
6.3 Features that would let you sell more (e.g. other key prefixes, per-key country locks,
    webhooks for key usage).

Send the answers to your Proxies.sx contact. We reply with concrete settings per use case
(pool, country, rotation and username) and fix anything on our side within the same week.
