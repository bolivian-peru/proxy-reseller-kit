# proxy-reseller-kit — Roadmap & open requests

> **Shared-pool contract update — 4 November 2026:** the [current release table and recovery contract](SHARED-POOL-CONTRACT.md) supersede older shared-key retry, automatic resume and session-release guidance here. Candidate APIs require verified provider deployment; package installation alone does not activate them. Persist intent, make one mutation attempt, recover by read-only operation lookup, and never resume from routine sync. Private-pool and provider-managed x402 payment flows remain separate.

Tracking deferred features so they don't fall on the floor between
round-trips. Each entry includes the source, target version, and
acceptance criteria.

---

## Recently shipped

- **0.5.0 — Pool Access Key security hardening** (2026‑05‑01). Three
  new SDK methods (`reveal`, `audit`, `auditForKey`) tracking the
  platform's pak_ security update. Auto-suspend on cap exceeded means
  shared-key top-ups leave disabled keys disabled; a separate reviewed conditional resume must check current quota, expiry, account and holds
  after `topUp` — starter app webhook updated. `RotationMode` widened
  to include `auto5 / auto20 / auto60 / ondemand` (was missing,
  caused typecheck errors). See SDK CHANGELOG.

---

## 0.5.x — In design

### Stale explicit-sid session auto-close

**Source:** reseller reply (2026‑05‑01) — production scrapers
crashing mid-batch leave 50+ sticky sessions warm, customer hits the
50-session-per-account cap before TTL evicts them.

**Suggested shape (reseller):**

```
DELETE /v1/gateway/pool/my-sessions?staleMinutes=15
```

Or as a flag on the existing close-all endpoint, e.g. body
`{ staleMinutes: 15 }`. Closes any session of the current user where
`Date.now() - lastActivityAt > staleMinutes * 60 * 1000`. Should
ignore synth-sid sessions (those already auto-die in 5 min).

**SDK shape (target 0.5.0):**

```ts
// @proxies-sx/pool-sdk
client.sessions.closeStale({ olderThanMinutes: 15 }):
  Promise<{ count: number }>;
```

**React (target 0.5.0):**

`<ActiveSessionsTable>` gets a header dropdown:
"Close all… [stale (>15 min idle) / all]".

**Implementation notes:**
- Gateway-side: filter on `lastActivityAt` from session store, then
  reuse the existing per-key delete flow.
- Should NOT fire on synth-sid sessions (5-min TTL handles them).
- Audit event: `sessions.closed_stale` with `count` + `cutoffMinutes`.

**Status:** Design pending.

---

## 0.5.x — Block 2 (Webhooks)

`pak.*` events extending the existing `reseller-webhook` infrastructure.
Full design at [`packages/sdk/docs/WEBHOOKS-DESIGN.md`](../packages/sdk/docs/WEBHOOKS-DESIGN.md).

**Source:** reseller 2026‑04‑30 audit (Block 2 from the original
production-readiness pass).

**Status:** Design done, implementation deferred until 0.3.1+0.4.0
have soaked in production for 2-4 weeks. Re-evaluate around 2026‑05‑20.

---

## 0.6.x — Block 3 (Bulk + tenant + history)

From the same 2026‑04‑30 audit:

- `client.poolKeys.bulkUpdate(ids, patch)`
- ~~`client.poolKeys.usageHistory(keyId, …)`~~ — shipped as `poolKeys.usage(keyId, { days })` + `poolKeys.usageSummary()` in 0.14.0 (platform daily rollup, 90-day retention)
- `ClientConfig.tenant` header for sub-reseller audit trails
- `client.poolKeys.archive(keyId)` (soft-delete with audit retention)

**Status:** Pending until a reseller hits 5K+ active keys (target Q3 2026).

---

## 0.7.x — Distribution (spec-kit extension + create-pool-portal)

Two paired distribution plays. Goal: move new-reseller onboarding from "clone the starter, hand-hold for a week" to "agent runs `/poolkit.scaffold`, working app in 30 minutes." Capture inbound from the AI-agent-driven dev cohort that's growing fast on `github/spec-kit`.

**Items:**

- **`create-pool-portal` CLI** — `npm create pool-portal` scaffold for a full Next.js reseller app with auth, Stripe, dashboard. Currently a Phase-2 placeholder in `apps/`. **Unblocks the extension** — the slash command is a thin orchestrator over this CLI.
- **`spec-kit-proxy-reseller-kit` extension** — ships ~7 slash commands (`/poolkit.scaffold`, `/poolkit.audit-integration`, `/poolkit.upgrade`, `/poolkit.add-payment`, `/poolkit.add-pak-key-flow`, `/poolkit.add-webhook`, `/poolkit.add-customer-dash`) plus templates for spec-kit's constitution / spec / plan / tasks artifacts. Lives in `packages/spec-kit-extension/` (monorepo, not sibling repo).
- **Companion preset** — `spec-kit-proxy-reseller-kit-preset` overrides spec-kit defaults with reseller-shaped templates. Independent of the extension; users can install one without the other.

**Source:** Spec-kit analysis 2026-05-03. Full plan: [`../SPEC-KIT-EXTENSION-PLAN.md`](../SPEC-KIT-EXTENSION-PLAN.md). Includes architecture, build sequence, version-pinning matrix, distribution strategy, success metrics, and decision log.

**Status:** Design captured, work deferred. **Trigger conditions** (any one fires → move to active):
1. `create-pool-portal` ships standalone (the extension is a thin orchestrator over it).
2. A reseller asks "do you have a spec-kit extension?" — signals demand from the right cohort.
3. Competing "white-label proxy" extension lands in `github/spec-kit` community catalog. Defend the slot.
4. ≥ 5 production resellers AND > 4 hours/month spent on per-reseller onboarding. Time to systematize.

If none fire by **2026-Q3**, revisit and decide whether to drop or push.

**Estimated effort when activated:** 2-3 dev-weeks (extension + preset + catalog submission), assuming `create-pool-portal` is already done.

---

## Optional / will-do-when-asked

| Item | Source | Notes |
|---|---|---|
| `<PoolPortalAdvanced>` wrapper | reseller 0.4.0 reply | Compose `<PoolPortal> + <PoolSessionSpawner> + <ActiveSessionsTable>` in one block. Skipped in 0.4.0 — revisit when 2+ resellers ask. |
| Cache TTL transparency in admin UI | reseller 0.3.1 audit | Admin banner showing "auth cache: 30s valid / 10s invalid" so resellers know what to expect after flag changes. Trivial. |
| Stable error `code` field in API responses | reseller 0.3.1 audit (Bug 5) | Currently `requestId` is the only structured field; `code` would let receivers branch programmatically. |
| Path namespace docs | reseller 0.3.1 audit (Bug 4) | Add a "Routes" section to packages/sdk/README.md that maps every SDK method → API path. |
| HMAC request signing | 2026‑04‑30 audit (Block 4) | Optional, not needed until a paying reseller asks. |
| Public OpenAPI for reseller surface | 2026‑04‑30 audit | Partly done: `GET /v1/reseller/docs/openapi` + `/llm` are public but cover sub-accounts / ports / webhooks / analytics, not `/reseller/pool-keys/*`. The kit's endpoint tables remain the pool-keys reference. |

---

## Done — for cross-reference

| Round-trip | Items | Date |
|---|---|---|
| 0.2.0 → 0.3.0 | Built-in retry, idempotency, requestId, `topUp()`, `get()` | 2026-05-01 |
| 0.3.0 → 0.3.1 | `PoolStock` type fix + runtime validator, KnownCountry widened | 2026-05-01 |
| 0.3.1 → 0.4.0 | Sessions API + `<PoolSessionSpawner>` + `<ActiveSessionsTable>` + 5-min synth TTL + `gw:` prefix DELETE bug | 2026-05-01 |
| Partnership flag | partner `poolFreeBandwidth: true` | 2026-05-01 13:08 UTC |
| Gateway diagnostics | X-Request-ID in 407 body + structured E_* codes + bonus pak_ fallback message clarity | 2026-05-01 |

Three round-trips in one day. Cadence to maintain.
