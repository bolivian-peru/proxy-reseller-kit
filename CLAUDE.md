# CLAUDE.md — proxy-reseller-kit

> Reading this means you're an AI agent (Claude Code, Cursor, etc.) helping a human build on top of the Proxies.sx Pool Gateway. This file tells you everything you need to know without having to read source. Treat it as authoritative.

## What this project is

`proxy-reseller-kit` is the open-source toolkit for **reselling the Proxies.sx Pool Gateway** under your own brand. Three deliverables:

1. **`@proxies-sx/pool-sdk`** — Typed TS/JS client for the reseller API. Mint/list/update Pool Access Keys (`pak_*`), build proxy URLs with the username-token DSL, fetch live stock. Foundation.
2. **`@proxies-sx/pool-portal-react`** — Drop-in React `<PoolPortal />` + headless hooks + `createPoolApiHandlers()` Next.js route factory. Host auth, trust boundary on the server.
3. **`create-pool-portal`** — CLI scaffold for a full Next.js reseller app with auth, Stripe, dashboard. (Phase 2 — not yet built.)

## The product this depends on

Upstream service: **Proxies.sx Pool Gateway** at `gw.proxies.sx:7000` (HTTP) and `:7001` (SOCKS5). The **peer** network is the flagship pool — real mobile + residential IPs across 80+ countries. The **mbl** (production ProxySmart modem) tier is the supportive starter tier: 6 countries — **US, GB, FR, NL, PL, GE (Georgia)**. Wholesale pricing has volume tiers — live rates in `client.proxies.sx` dashboard. Don't hardcode prices anywhere.

Reseller API: `https://api.proxies.sx/v1/reseller/pool-keys`. Auth with an API key (`psx_*`) minted at `client.proxies.sx/account` with scope `customers:write`.

## How auth works between the layers

```
Customer's HTTP client
      │ proxy string (contains pak_customer_key)
      ▼
gw.proxies.sx:7000   ← Customer's traffic goes here DIRECTLY
(Proxies.sx gateway)

Customer's browser
      │ (normal web session)
      ▼
Reseller's deployed app (yourdomain.com)
      │ uses @proxies-sx/pool-sdk with psx_ reseller API key
      ▼
api.proxies.sx/v1/reseller/pool-keys   ← Customer NEVER touches this
```

The `pak_` key is the *customer's* credential. The `psx_` API key is the *reseller's* credential and MUST stay server-side.

## Engineering principles (how to write code in this repo)

This is a public, MIT-licensed SDK that strangers will read, fork, and trust with their customers' credentials. The bar is therefore higher than internal code: every line is documentation by example. The principles below are inherited verbatim from Anthropic's [`code-simplifier`](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md) agent and are binding when you modify anything here.

1. **Preserve functionality.** "Never change what the code does — only how it does it." The SDK has published consumers; a refactor that alters a return shape, an error type, or a URL-encoding edge case is a breaking change even if no test caught it. Behavior is the contract.
2. **Apply project standards.** ES modules, `function` over arrow functions, explicit return-type annotations, React `Props` types, real error handling, consistent naming. New code must be indistinguishable from the code beside it.
3. **Clarity over brevity.** "Explicit code is often better than overly compact code." A reseller debugging their integration at 2am will read this source. Optimize for that reader, not for line count.
4. **No nested ternaries.** "Prefer switch statements or if/else chains for multiple conditions." Control flow must be visible.
5. **Don't over-simplify.** Do not remove helpful abstractions, fuse unrelated concerns, or trade debuggability for cleverness. The `url.ts` token builder, the retry/jitter logic, and the runtime validators look verbose *on purpose* — that verbosity is what makes them safe to extend.
6. **Scope discipline.** "Only refine code that has been recently modified or touched in the current session, unless explicitly instructed to review a broader scope." If you're adding a method to `client.ts`, you are not reformatting `types.ts` because you opened it.

**The reasoning behind the rules:** an SDK earns trust by being predictable. Predictability is a property of the *whole surface over time*, not of any single clever commit — so the discipline is conservative on purpose. When a change to the platform contract collides with a desire for cleaner code, the contract wins and the cleanliness waits. When two implementations are equally correct, choose the one a forking stranger will understand fastest. And when you genuinely see a better shape — a clearer type, a simpler handler dispatch, a method that should exist — propose it and build it; "feel free to customize" is real, the floor is only the [Key invariants](#key-invariants) and the security model below, everything above that floor is craft you're trusted to exercise.

## Repo layout

```
proxy-reseller-kit/
├── packages/
│   ├── sdk/              # @proxies-sx/pool-sdk            ✅ built
│   └── react/            # @proxies-sx/pool-portal-react   ✅ built
├── apps/                 # reserved for create-pool-portal template
├── package.json          # workspace root
├── pnpm-workspace.yaml
├── CLAUDE.md             # this file
└── LICENSE               # MIT
```

### packages/react tasks

- **Add a new prop to `<PoolPortal>`** → edit `packages/react/src/PoolPortal.tsx`, extend `PoolPortalProps`, update README props table.
- **Add a new hook** → write in `packages/react/src/hooks.ts`, export from `src/index.ts`.
- **Add a new server handler** → edit `packages/react/src/server.ts`; keep path-based dispatch simple.
- **Restyle component without forking it** → users pass `classNames` prop or import/override the CSS custom properties from `styles.css`.

## Two-sided dashboard pattern — ASK FIRST

When a user asks to build "a Pool dashboard" or "a reseller portal," **ask which side first** — admin or customer? Most production resellers ship both, but they're fundamentally different:

- **Admin side** (e.g. `admin.brand.com`) — operators manage tariffs, customers, top-ups, audit. Built on the reseller's existing admin framework. Calls `ProxiesClient` methods directly. Does NOT use the React components.
- **Customer side** (e.g. `dashboard.brand.com`) — end-customers self-serve. Uses `@proxies-sx/pool-portal-react` components composed into the reseller's customer-frontend.

If they say "both," build customer side first (the React components do most of the work) and layer admin on top of their existing admin app. **Never reuse customer components for admin pages** — they're shaped for one-customer-self-service, admin needs N-customer tables.

Full pattern (with concrete examples + Coronium reference architecture): [`docs/TWO-SIDED-DASHBOARD.md`](./docs/TWO-SIDED-DASHBOARD.md).

---

## What's new in SDK 0.3.x (read before writing code)

The SDK matured from 0.2.0 (stable surface, no retry, type-loose) to
0.3.1 (production-ready). When generating example code or migrations,
default to these patterns:

- **Retry on by default.** `new ProxiesClient({ retry: { attempts, baseDelayMs, maxDelayMs } })` — fires on 5xx/429/timeouts/network with full jitter, honors `Retry-After`. Skips 4xx (except 429). Pass `retry: false` to disable. **Never** wrap your own retry around SDK calls — it causes thundering herd.
- **Idempotency-Key on writes.** `create({ ..., idempotencyKey })`, `topUp(id, { ..., idempotencyKey })`, `regenerate(id, { idempotencyKey })`. Tie the key to a domain object (Stripe event id, ledger id, invoice id) — never `randomUUID()` inline at retry time. Platform dedupes within 24h.
- **Top-up via `poolKeys.topUp()`** (not `update()`). Server-side atomic single-write: `addTrafficGB` is `$inc`-d, `extendDays` extends from `max(now, current_expiresAt)` (never shortens). Replaces the read-modify-write race.
- **`poolKeys.get(id)`** for single-record fetch. Don't `list()` + filter on a known id.
- **`ProxiesApiError.requestId`** is populated from the `X-Request-ID` response header. Log it on every error path; paste in support tickets to skip log-grepping.
- **`PoolStock` shape** (fixed in 0.3.1): `{ pools: { mbl, peer }, totals, generatedAt }`. The 0.2.x type `{ countries: [...] }` never matched the live API. Runtime validator throws `ProxiesError` if upstream drifts again.
- **`Country`** is now `KnownCountry | (string & {})` — string-assignable so future-supported countries don't require an SDK bump, but `KnownCountry` keeps autocomplete for the curated list.

For migration of existing 0.2.0 integrations, see [`docs/MIGRATION-0.3.0.md`](./docs/MIGRATION-0.3.0.md).

For webhooks (Block 2, target 0.4.0), see [`packages/sdk/docs/WEBHOOKS-DESIGN.md`](./packages/sdk/docs/WEBHOOKS-DESIGN.md).

## Common agent tasks

### Add a new country to the SDK
Edit `packages/sdk/src/types.ts` — the `KnownCountry` type union (NOT
`Country` — that's `KnownCountry | (string & {})` and is intentionally
permissive). Also update the TSDoc example in `packages/sdk/src/url.ts`. Then update `packages/sdk/README.md`.

### Bump the SDK version
Edit `packages/sdk/package.json` version field. Run `pnpm -r --filter @proxies-sx/pool-sdk build`. Publish with `pnpm publish --filter @proxies-sx/pool-sdk`.

### Add a new reseller API endpoint to the SDK
1. Add method to the relevant API class in `packages/sdk/src/client.ts`
2. Add types in `packages/sdk/src/types.ts`
3. Add TSDoc with an example
4. Add a test in `packages/sdk/test/`
5. Document in `packages/sdk/README.md`

### Change the default gateway URL (e.g. for a regional edge)
Edit `packages/sdk/src/url.ts` — the `GATEWAY_HOST` constant. This flows through to `buildProxyUrl`.

### Add a new rotation mode
Extend `RotationMode` union in `packages/sdk/src/types.ts`. Test coverage in `packages/sdk/test/url.test.ts`.

## Don't do these things

- **Never** hardcode a reseller's `psx_` API key in source, examples, or tests. Use `process.env.PROXIES_SX_API_KEY` or fixtures that are `psx_test_...` placeholders.
- **Never** expose the reseller API key to the browser bundle. The SDK is designed to run server-side. `buildProxyUrl()` is the only truly browser-safe export — even then, passing real `pak_` keys to the browser is the host app's choice, not the SDK's concern.
- **Never** log `pak_` keys in full. Truncate to `pak_...` in any log output.
- **Never** commit `.env` files. `.env.example` only.

## Development commands

```bash
# From repo root
pnpm install                              # install workspace deps
pnpm -r --filter @proxies-sx/pool-sdk build
pnpm -r --filter @proxies-sx/pool-sdk test
pnpm -r --filter @proxies-sx/pool-sdk typecheck
```

## Publishing

```bash
# Make sure you're logged into npm as a proxies-sx org member
cd packages/sdk
npm version patch             # or minor/major
pnpm build
npm publish --access public
```

## Key invariants

1. `buildProxyUrl()` output MUST be URL-encoded — username/password may contain `@`/`:` in the user's `sid` token.
2. `pak_` keys regenerated via `regenerate()` invalidate the old value **immediately** — the old pak_ stops working mid-session.
3. `trafficCapGB: null` means "unlimited within reseller's own pool." `0` would mean "blocked." Never confuse them.
4. `expiresAt: null` means "never expires." Setting a Date or ISO string in the past is rejected by the platform — use `enabled: false` to disable a key, not a past date.
5. Expired keys are rejected by the gateway **immediately** (inline check on every auth). The platform's nightly cron at 03:30 UTC just flips `enabled = false` for tidiness; revocation does not depend on it.
6. The SDK never caches responses. Callers who need caching layer it themselves (React Query, SWR, etc.).

## Common agent tasks (continued)

### Add a new field to `PoolAccessKey`
1. Update the platform schema (`gb-system-api/src/reseller/schemas/pool-access-key.schema.ts`) and serializer.
2. Mirror the field in `packages/sdk/src/types.ts` (`PoolAccessKey` interface). Add to `CreatePoolAccessKeyInput` / `UpdatePoolAccessKeyInput` if writable.
3. Bump SDK + React minor versions, document in both READMEs and `SKILL.md`, regenerate the React `MeResponse.usage` shape if exposed to the dashboard.

## Server-side security model the SDK rides on (May 2026)

**`psx_` API key callers bypass fresh-auth.** The platform's `FreshAuthGuard` only fires on interactive JWT sessions. SDK consumers using a server-stored `psx_` API key never see `FRESH_AUTH_REQUIRED` 401s and don't need to handle them. This is intentional — server-side automation can't re-authenticate interactively.

**Compensating controls** (so the SDK isn't the weak link): per-key rate limit (passport-strategy enforced), scope checks (`customers:write` for pool-keys ops), and a 90-day audit log on every mutation that records `ip`, `userAgent`, `requestId`, and `authMethod: 'apiKey'`.

**Auto-suspend on cap**: when a `pak_`'s `trafficUsedMB / 1024 >= trafficCapGB`, the platform flips `enabled = false` automatically and records `auto_suspended_cap_exceeded`. The SDK's `topUp()` extends the cap but does NOT auto re-enable — callers must explicitly `update(id, { enabled: true })` to bring a suspended key back online. This is by design: a leaked key that auto-recovered would defeat the suspend.

**Reveal + audit endpoints (shipped in the SDK since 0.5.x):**
- `client.poolKeys.reveal(id)` — audit-logged unmask (`POST /pool-keys/:id/reveal`). Returns same shape as `get()`.
- `client.poolKeys.audit({ action?, before?, limit? })` — forensic log across all keys (`GET /pool-keys/audit`).
- `client.poolKeys.auditForKey(id, { before?, limit? })` — same scoped to one key (`GET /pool-keys/:id/audit`).

All three are typed in `src/types.ts` (`PoolAccessKeyAuditEvent`, `AuditQueryOpts`) with TSDoc examples in `src/client.ts`.

## Documentation map (keep these in sync when behavior changes)

The kit's knowledge lives in three tiers. When you change behavior, update the tier(s) that describe it — drift between them is the most common way this kit misleads the people building on it.

| Tier | Where | Audience | Update when… |
|---|---|---|---|
| **Code-adjacent** | `README.md`, `packages/*/README.md`, `SKILL.md`, this file | Agents + devs integrating or extending | The API surface, invariants, or security model changes |
| **In-repo docs** | `docs/X402-RESELLER-INTEGRATION.md`, `docs/TWO-SIDED-DASHBOARD.md`, `docs/MIGRATION-*.md` | Devs implementing a specific pattern | A pattern's shape changes, or a new version migration lands |
| **Wiki** | [github.com/bolivian-peru/proxy-reseller-kit/wiki](https://github.com/bolivian-peru/proxy-reseller-kit/wiki) | Resellers (operational + conceptual) | Operational reality shifts — new error codes, country stock, sticky behavior |

**Wiki pages** (8, MVP shipped May 2026): Home, Getting-Started, Integration-Paths, Sticky-Sessions-and-Rotation, Pak-Key-Lifecycle, x402-and-Wallet-Setup, Troubleshooting, Glossary. Editable via `git clone https://github.com/bolivian-peru/proxy-reseller-kit.wiki.git` — direct push to `master`, no PR. Four more pages are tracked-but-deliberately-unbuilt (Webhooks, Migrating-From-Another-Provider, Pricing-Strategy, Per-Country-Stock); each has an explicit trigger condition and should NOT be written speculatively — wait for the real reseller question that justifies it.

**The x402 payment rail** is documented but not yet packaged: `docs/X402-RESELLER-INTEGRATION.md` (code) + the x402-and-Wallet-Setup wiki page (operations) are canonical. A `createX402PaidProxyHandler()` factory for `@proxies-sx/pool-portal-react/server` is earmarked for **0.7.x** — until it ships, the copy-paste handler in the doc is the implementation. If you build that factory, follow the existing `createPoolApiHandlers()` shape in `packages/react/src/server.ts` and keep the verification/mint/return stages legible (see Engineering principle 5 — this is exactly the kind of code that should stay verbose).

## Future direction docs

Long-form plans for work that's been designed but deliberately not started. Read these before proposing roadmap changes — the trade-offs are already laid out.

- [`SPEC-KIT-EXTENSION-PLAN.md`](./SPEC-KIT-EXTENSION-PLAN.md) (root) — durable plan for shipping `proxy-reseller-kit` as a [github/spec-kit](https://github.com/github/spec-kit) extension. Adds `/poolkit.scaffold`, `/poolkit.audit-integration`, `/poolkit.upgrade`, etc. as slash commands on top of spec-kit's harness. Targets 0.7.x, paired with the `create-pool-portal` CLI. Has explicit trigger conditions for moving from "tracked" to "in flight" — don't act before they fire.

## License

MIT for the SDK. Apache 2.0 for the Next.js starter template (when it ships). The SDK's permissive license is intentional: we want *everyone* to build on top.
