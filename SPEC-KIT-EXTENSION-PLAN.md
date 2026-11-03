# Spec-Kit Extension Plan — `spec-kit-proxy-reseller-kit`

> **Status:** Design proposal. Do not implement before 0.7.x.
> **Author:** Proxies.sx engineering, 2026-05-03
> **Pairs with:** `create-pool-portal` (Phase 2 CLI scaffold, also unbuilt)
> **Tracking:** [`docs/BACKLOG.md`](./docs/BACKLOG.md) → "0.7.x — Distribution"

This document is the durable plan for shipping `proxy-reseller-kit` as a [GitHub spec-kit](https://github.com/github/spec-kit) extension. We don't act on it today — two production resellers are already integrated, and the form factor only pays off when we want the 3rd / 4th / Nth reseller to onboard with zero hand-holding. Capture the design now while the analysis is fresh, revisit when the trigger conditions below are met.

---

## 1. Why ship as a spec-kit extension at all

### What spec-kit is

GitHub's open-source toolkit (`github/spec-kit`) for Spec-Driven Development. Installs via `uv tool install specify-cli`. Gives AI coding agents a set of slash commands (`/speckit.constitution`, `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.implement`) plus an extension marketplace of ~80 community-built extensions ranging from "Jira sync" to "OWASP LLM threat model" to domain-bundle workflows like "SFSpeckit" (Salesforce SDLC).

### What an extension provides

A spec-kit extension installs templates and slash commands into the consumer's `.specify/extensions/` directory and into their AI agent's command directory (`.claude/commands/`, `.cursor/commands/`, etc.). The agent then has access to those commands the same way it has access to spec-kit's core commands.

This is exactly the harness shape we need for `create-pool-portal`. We've been imagining it as a `npx create-pool-portal` CLI — but for AI-agent-driven workflows, the `/poolkit.scaffold` slash command is a strictly better UX:

- Agent already has the user's project context (existing files, branding, package manager)
- Agent can ask interactive clarification questions cheaply
- Agent can run the scaffold inline, edit files, commit, push, all without context-switching to a CLI

### Why now (analysis), defer (action)

**Analysis now** — spec-kit is moving fast. The community catalog grew from ~10 extensions to ~80 in 4 months. Every month we wait, more domain-bundle competitors might claim our slot ("WhiteLabelProxyKit" or similar). The catalog has a *first-mover effect on the search ranking within the ecosystem* — early extensions get more stars, more PRs, more visibility. Worth knowing what we'd ship.

**Action deferred** — three reasons:
1. **No paying-reseller demand yet.** both production resellers cloned the starter app manually. Nobody has asked "is this on spec-kit?"
2. **`create-pool-portal` doesn't exist yet.** The extension is a thin orchestrator over that scaffold. Building the orchestrator before the thing it orchestrates is backwards.
3. **The 0.5.0 → 0.6.x roadmap has higher-impact work.** Block 2 webhooks (pak.* events), Block 3 bulk operations + `usageHistory`, stale-session auto-close. Those move revenue. A spec-kit extension moves discovery — important but second-order.

### Trigger conditions for moving from "tracked" to "in flight"

Move this to active work when **any** of these become true:

- `create-pool-portal` ships (Phase 2). The extension is a thin orchestrator over it; we need it to exist.
- A reseller asks "do you have a spec-kit extension?" — signals demand from the right cohort.
- The community catalog gets a competing "white-label proxy" extension. Defend the slot.
- We have ≥ 5 production resellers and are spending > 4 hours/month on per-reseller onboarding. Time to systematize.

If none of these by **2026-Q3**, revisit and decide whether to drop the plan or push the trigger.

---

## 2. What the extension actually ships

### Slash commands

| Command | Effect | Read/Write | Audience |
|---|---|---|---|
| `/poolkit.scaffold` | Walks the user through "name your brand, pick countries, pick payment provider" → outputs a configured starter app (clone of `apps/starter/` with config baked in). | Read+Write | New reseller, greenfield project |
| `/poolkit.add-payment` | Adds Stripe / Paddle / USDT to an existing portal. Wires the webhook handler with idempotency + auto-suspend re-enable already correct. | Read+Write | Existing reseller, new payment rail |
| `/poolkit.add-pak-key-flow` | Generates a complete mint → assign → display (masked + reveal-on-demand) → rotate flow with all 0.5.0 security defaults baked in. | Read+Write | Reseller adding pak_ management to a non-Next.js app (Express, Fastify, Hono) |
| `/poolkit.upgrade` | Detects pre-0.5.0 integration patterns (`topUp` without `update({enabled:true})`, full pak_ value in customer dashboard, missing `Idempotency-Key` on writes, etc.) and applies fixes with explanations. | Read+Write | Reseller on old SDK |
| `/poolkit.audit-integration` | Read-only health check. Verifies the reseller's integration follows current best practices. Reports diffs against the canonical patterns from `apps/starter/`. | Read-only | Any reseller, periodically |
| `/poolkit.add-webhook` | Generates the reseller's HTTP handler for `pak.*` webhook events (when Block 2 ships in 0.5.x platform). HMAC verification + replay protection + idempotency. | Read+Write | Reseller wanting reactive UX (cap warning emails, etc.) |
| `/poolkit.add-customer-dash` | Drops in the customer-facing React components (`<PoolPortal>`, `<PoolSessionSpawner>`, `<ActiveSessionsTable>`, etc.) into an existing React app. | Read+Write | Reseller with existing customer-facing app, just adding the proxy section |

### Templates

The extension ships templates for these spec-kit artifacts:

- **`constitution.md`** — pre-seeded with the canonical reseller-app principles: server-side `psx_` only, customer never sees reseller credentials, idempotency on every write, audit-log every state change, pak_ masked-by-default in customer UIs, etc.
- **`spec.md`** — domain-specific spec template with sections for: target reseller persona, pricing tiers, country list, payment rails, fraud-mitigation posture, data-residency requirements, branding constraints.
- **`plan.md`** — reseller-app-shaped plan template: stack defaults to Next.js + Postgres + Stripe + NextAuth (matching `apps/starter/`), with escape hatches.
- **`tasks.md`** — task list ordered by the typical reseller-onboarding critical path (domain → SSL → Stripe webhook signing secret → first test purchase → soft launch).
- **`checklists/` directory** — pre-built checklists: pre-launch security, pre-launch billing, post-launch monitoring, abuse-response runbook.

### Behavioral defaults (the spec-kit "preset")

We can ship a paired **preset** alongside the extension that overrides spec-kit's default behaviors with reseller-specific defaults:

- `/speckit.specify` template prompts default to ask about the reseller's pricing model, target geography, and existing customer base.
- `/speckit.plan` template defaults to recommending our stack (Next.js + Postgres + Stripe + NextAuth) with rationale, but doesn't force it.
- `/speckit.analyze` is preconfigured to flag missing-fresh-auth, missing-idempotency, and full-pak_-exposure as drift issues.

Presets and extensions are independent in spec-kit. We'd ship both, named `spec-kit-proxy-reseller-kit` (extension) and `spec-kit-proxy-reseller-kit-preset` (preset). Users can install one without the other.

---

## 3. Architecture & repository layout

The extension lives **in this repo**, not a separate one. Adding a new top-level directory:

```
proxy-reseller-kit/
├── packages/
│   ├── sdk/
│   ├── react/
│   └── spec-kit-extension/         ← NEW (target 0.7.x)
│       ├── package.json
│       ├── README.md
│       ├── extension.json          ← spec-kit manifest
│       ├── commands/
│       │   ├── poolkit.scaffold.md
│       │   ├── poolkit.add-payment.md
│       │   ├── poolkit.add-pak-key-flow.md
│       │   ├── poolkit.upgrade.md
│       │   ├── poolkit.audit-integration.md
│       │   ├── poolkit.add-webhook.md
│       │   └── poolkit.add-customer-dash.md
│       ├── templates/
│       │   ├── constitution.md
│       │   ├── spec.md
│       │   ├── plan.md
│       │   ├── tasks.md
│       │   └── checklists/
│       │       ├── pre-launch-security.md
│       │       ├── pre-launch-billing.md
│       │       ├── post-launch-monitoring.md
│       │       └── abuse-response.md
│       └── tests/
│           └── fixtures/
└── apps/
    └── starter/                    ← consumed by /poolkit.scaffold
```

**Why same repo:** the extension's commands need to stay in lock-step with `apps/starter/`, the SDK, and the React components. Splitting them invites version drift. spec-kit's catalog format expects extensions in their own repos by convention but doesn't require it — the catalog entry just points at a path within whatever repo.

**Why not a sibling repo (`spec-kit-proxy-reseller-kit`) on bolivian-peru:** would split the maintenance surface, force two PRs for any cross-cutting change, and dilute stars/visibility. Reconsider only if the extension grows past ~3000 LOC of templates and starts deserving its own CHANGELOG.

---

## 4. Build sequence (when we eventually act)

Estimated 2-3 dev-weeks total. Order matters — earlier items unblock later.

1. **`create-pool-portal` CLI must exist first.** This is the unblocker. Until `npm create pool-portal` produces a working starter, `/poolkit.scaffold` has nothing to call. Roughly 1 dev-week of work itself; tracked separately.
2. **Skeleton extension package** (~half-day). `extension.json` manifest, `commands/` directory with stubbed `.md` files, basic `tests/` setup. Just enough that `specify extension add` finds and installs it locally.
3. **`/poolkit.scaffold` first** (~2 days). Highest-impact command. Gets the agent through "I want to start a reseller business" → working app on disk. Test against a fresh empty directory + running through the spec-kit harness end-to-end.
4. **`/poolkit.audit-integration` next** (~1 day). Read-only diagnostic. Easy to write because the canonical-patterns reference is `apps/starter/` itself. High value for existing resellers.
5. **`/poolkit.upgrade` next** (~1-2 days). Detects-and-fixes for pre-0.5.0 patterns. The detection logic is what's already documented in the May 2026 security-update notes — we just encode it as agent instructions.
6. **`/poolkit.add-payment` after** (~2 days). Modular — Stripe variant first, USDT/Paddle later. Most resellers will already have payment via the starter; this is for the long-tail.
7. **`/poolkit.add-pak-key-flow`** (~2 days). For non-Next.js stacks. Generates Express / Fastify / Hono templates. Lower priority — most resellers we've seen are on Next.js.
8. **`/poolkit.add-webhook`** — depends on Block 2 (pak.* webhooks) shipping. Wait.
9. **`/poolkit.add-customer-dash`** (~1 day). Thin — just a template that adds `<PoolPortal>` to an existing React app.
10. **Templates + checklists** (~3 days, can parallel with commands). The constitution/spec/plan/tasks templates are content-heavy but rote.
11. **Submit to community catalog** (~half-day). PR against `github/spec-kit` `catalog.community.json`. Review takes 1-3 weeks based on observed cadence.

---

## 5. Compatibility & versioning

### Spec-kit version pinning

The extension declares which spec-kit major it targets. Spec-kit itself is in active 0.x; when 1.0 ships the extension API stabilizes. **Pin to a specific spec-kit version on initial release** and bump deliberately. Don't track `latest`.

### Our SDK version pinning

`/poolkit.scaffold` and `/poolkit.add-pak-key-flow` generate code that imports `@proxies-sx/pool-sdk`. The extension version pins the minimum SDK version it requires. Bump in lock-step:

| Extension version | Minimum `@proxies-sx/pool-sdk` | Rationale |
|---|---|---|
| 0.1.0 | `^0.5.0` | Initial — uses reveal/audit/auditForKey + auto-suspend pattern |
| 0.2.0 | `^0.6.0` | When Block 2 webhooks land |
| 0.3.0 | `^0.7.0` | When Block 3 bulk ops land |

### Our React-package version pinning

Same logic. `/poolkit.add-customer-dash` pins minimum `@proxies-sx/pool-portal-react` version.

### Backwards compat

The extension never touches files it doesn't own. Generated files use clear `// generated by /poolkit.scaffold — safe to edit` headers. No silent regen on subsequent invocations. If we ship a breaking change to the scaffold output, it's a major version bump on the extension AND a one-line deprecation notice on the slash command.

---

## 6. Distribution & marketing

### Catalog submission

PR against `github/spec-kit/extensions/catalog.community.json`. Entry shape:

```json
{
  "name": "Proxy Reseller Kit",
  "purpose": "Build a branded mobile-proxy reseller business on the Proxies.sx Pool Gateway. Scaffolds Next.js + Stripe + auth with auto-suspend and audit-log defaults baked in.",
  "category": "process",
  "effect": "Read+Write",
  "url": "https://github.com/bolivian-peru/proxy-reseller-kit/tree/main/packages/spec-kit-extension"
}
```

Choose category: `process` is the closest fit since it orchestrates a multi-phase reseller workflow. `code` is too narrow.

### Companion content

When we ship the extension, also publish:

1. **Walkthrough** — submit to `github/spec-kit` community walkthroughs. Title: "Build a paid mobile-proxy reseller business in 30 minutes." Markdown with screenshots, end-to-end transcript of the slash commands.
2. **Blog post / ECOSYSTEM-MAP entry** on agents.proxies.sx. Cross-link from the proxy-reseller-kit README.
3. **Tweet / Telegram-channel announcement** — same content, different channels.

### SEO note

The repo has just been renamed from `pool-starter` to `proxy-reseller-kit` (2026-05-03) specifically for SEO discoverability on the "proxy reseller" search term. Before submitting to the spec-kit catalog, double-check that:

- The catalog entry's `name` and `purpose` use "proxy reseller" verbatim.
- The README's first sentence repeats the keyword for AI-search-engine parsing.
- The walkthrough's title contains "proxy reseller".

### Risks / antipatterns

- **Don't make the extension feel like an ad.** Catalog reviewers reject self-promoting extensions that don't actually deliver value beyond "buy our product." The extension must be useful even if you weren't already paying for the proxy service — at minimum, the audit / upgrade commands work without an active subscription.
- **Don't overlap with spec-kit core.** `/poolkit.scaffold` is fine because it's domain-specific. `/poolkit.implement` would just duplicate `/speckit.implement` poorly. Stay in our lane.
- **Don't ship until `create-pool-portal` works end-to-end.** Reviewers will install the extension and try `/poolkit.scaffold` first. If it errors, the extension gets a 1-star review and the listing is hard to recover from.

---

## 7. Success metrics

If the extension ships and we want to measure whether it's working, track:

| Metric | Source | Target (12 mo post-ship) |
|---|---|---|
| Stars on `proxy-reseller-kit` repo | GitHub | +200 (vs. baseline at ship) |
| Distinct installers of the extension | spec-kit telemetry (if available), else npm-install logs from the SDK | 50+ |
| Resellers who used `/poolkit.scaffold` and went on to mint > 100 production pak_ keys | Backend join: pak owner accounts created via OAuth/SSO from a portal we know was scaffolded | 5+ |
| Catalog visibility rank for "proxy" / "saas" search | Manual spot-check on speckit-community.github.io | Top 5 |
| Time to first production pak_ for new resellers | Onboarding analytics | < 4 hours (vs. baseline ~1 week with hand-holding) |

If after 12 months we're below half these targets, the extension has failed product-market fit. Sunset it (catalog removal + deprecation notice) rather than let it rot.

---

## 8. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-03 | Plan created, work deferred | both production resellers already integrated; `create-pool-portal` doesn't exist yet; higher-revenue work in 0.5.x/0.6.x. Capture the design while fresh, revisit when triggers fire. |
| 2026-05-03 | Will live in monorepo (`packages/spec-kit-extension/`), not sibling repo | Keep extension in lock-step with SDK, React, starter; avoid two-PR overhead for cross-cutting changes. Reconsider if it grows past ~3000 LOC. |
| 2026-05-03 | Extension AND preset will be shipped as siblings, not bundled | Independent in spec-kit; lets users adopt one without the other. Preset overrides default templates; extension adds new commands. |
| 2026-05-03 | Repo renamed `pool-starter` → `proxy-reseller-kit` | SEO on the "proxy reseller" search term; benefits the extension catalog listing too. |

---

## 9. Open questions (resolve before action)

1. **Is the spec-kit extension API stable enough for us to commit to it?** Spec-kit is at 0.x. The extension manifest format may change. Before building, audit the changelog of `github/spec-kit` for the last 6 months to gauge churn.
2. **Telemetry / analytics from the extension?** Spec-kit doesn't ship a built-in analytics hook (yet). If we want to know who's using `/poolkit.scaffold`, we'd need to either fingerprint generated code or send a one-shot install ping. Both have privacy implications. Default: **no telemetry**, infer adoption from npm download counts on the SDK.
3. **License compatibility?** Spec-kit core is under MIT. Our extension would also be MIT. Community extensions can choose other licenses; check whether catalog acceptance has a license requirement.
4. **Multi-agent support priority.** Spec-kit lists Claude Code, Cursor, Copilot, Codex, Aider, Continue, etc. Our slash commands need to work across all of them. Prioritize Claude Code + Cursor first (highest adoption among our target audience). Ship others post-launch.

---

## 10. Maintenance posture (post-ship)

If we ship and the extension has < 10 active users a year in, the maintenance burden is low — answer occasional issues, bump SDK version pins on each minor SDK release. Probably ~1 hour/month.

If it has 100+ active users, expect: feature requests, "doesn't work with my Next.js 16 setup" issues, agent-specific bugs (Claude Code vs. Cursor parsing the command differently). Budget ~1 day/week or bring on a contributor.

If it gets 1000+ users — that's a great problem and we'd staff accordingly.

**Trigger to deprecate:** if spec-kit itself loses market share to a successor (this isn't impossible — the AI-agent tooling space is volatile), and that successor has its own extension model, we re-evaluate. The slash commands themselves would port; the harness wouldn't.
