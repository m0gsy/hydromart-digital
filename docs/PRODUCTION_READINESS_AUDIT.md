# Hydromart — Production Readiness Audit

**Date:** 2026-07-18
**Branch:** `feat/depot-consoles`
**Auditor role:** Senior QA / SDET / Security / Performance / Architect
**Method:** static gates (format/lint/typecheck/build) + live stack (21 containers up) API/E2E probing + specialist review agents (security, database) + code inspection.
**Scope weighting:** balanced across all dimensions.

> System: npm-workspaces monorepo. 17 NestJS 10 + Prisma 5 microservices, 1 Next.js 15 web app
> (`apps/web`), shared `packages/access` (RBAC) + `packages/platform`. DB-per-service (~71 migrations),
> API gateway, Caddy TLS (opt-in), scheduler sidecar. Live stack verified all-healthy during audit.

---

## PRODUCTION DECISION: **READY WITH RISKS** → blocked to **NOT READY** until SEC-1 resolved

The application is a genuinely well-engineered system (clean hexagonal architecture, single-source
RBAC, fail-closed auth, integer/Decimal money discipline, strong DTO+env validation, broad tests,
all core static gates green). **However, one CRITICAL security defect (SEC-1, payment price-tampering)
and two CRITICAL data-integrity races (DB-1, DB-2) exist.** Per the audit's own rule — _no Critical
may remain for PRODUCTION READY_ — the verdict is:

- **NOT READY** while SEC-1 / DB-1 / DB-2 are open.
- Downgrades to **READY WITH RISKS** once those three are fixed and the High items are either fixed
  or accepted (several are pre-mitigated: online gateway not yet live, single-replica deploy).
- **PRODUCTION READY** additionally requires: coverage gate met (target >90%), monitoring/APM +
  alerting operational, a validated restore drill, and the High-severity trust-boundary (SEC-2) fixed.

---

## Gate results (Waves 1–3)

| Gate                                                           | Result                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Prettier `format:check`                                        | ✅ PASS (clean)                                                   |
| ESLint `lint` (`--max-warnings 0`, all workspaces)             | ✅ PASS (0 errors, 0 warnings)                                    |
| `typecheck` (tsc, all workspaces)                              | ✅ PASS (0 type errors)                                           |
| `build` (all workspaces incl. `next build`)                    | ✅ PASS (web bundles healthy: shared 103 kB, routes 144–205 kB)   |
| Unit + e2e tests (`npm test`)                                  | ✅ PASS — 0 failures across all workspaces (exit 0)               |
| Live Lighthouse (mobile, `/`)                                  | ✅ Accessibility 96, Best Practices 96, SEO 100                   |
| `npm audit` (prod deps)                                        | ⚠️ 16 vulns (13 moderate, 3 high), **0 critical**; all transitive |
| Live smoke (gateway `/health`, web)                            | ✅ PASS                                                           |
| Live API matrix (401/403/404/pagination/rate-limit-headers)    | ✅ PASS                                                           |
| Live RBAC (DRIVER→403 on reports/depot-admin, 200 own loyalty) | ✅ PASS                                                           |
| Live money path (cart→pricing→subtotal)                        | ✅ PASS (validated with real-UUID product)                        |

Governance thresholds (`.claude/QUALITY_GATES.md`): coverage **>90%**, maintainability **>80**,
cyclomatic **<10**, Lighthouse **>95**, WCAG **AA**, 0 type/lint/critical+high-security. Coverage
threshold is **not enforced in CI** (see QG-1).

---

## Findings

Format per issue: **Severity — Title** · Root cause · Fix · Files · Risk · Priority.

### CRITICAL

**SEC-1 — Payment `amount` is client-supplied and never validated against the order total.**

- Root cause: `POST /payments` accepts `{orderId, method, amount}` from an authenticated CUSTOMER;
  `PaymentService.initiate` never fetches the authoritative order total. Online webhook path confirms
  the order (`internal-confirm`) with no amount check; webhook HMAC signs `${reference}.${event}`
  only (no amount).
- Impact: a customer can pay a near-zero amount for a real order and still have it confirmed/fulfilled
  (price tampering / business-logic bypass).
- Fix: in `initiate`, fetch the order total server-to-server (extend `OrderCoordinationPort` with a
  `getOrderTotal(orderId)` over the existing `x-internal-key` path) and reject when `amount ≠ total`;
  fold `amount` into the webhook HMAC payload.
- Files: `services/payment-service/src/application/services/payment.service.ts:83-128`,
  `services/payment-service/src/modules/dto/payment.dto.ts:21`,
  `services/order-service/src/modules/order.controller.ts:274` (internal-confirm).
- Risk: revenue loss / fraud. Pre-mitigation: no live online gateway yet (cash/QRIS/transfer are
  operator-verified), so exploitation of the _automated_ path is not currently reachable — but the
  code is production-shaped and the flaw is real.
- Priority: **P0 — must fix before enabling any online gateway or wider launch.**

**DB-1 — "One active payment per order" is check-then-act with no DB constraint (double-charge race).**

- Root cause: `initiate` does `findActiveByOrder` then `create` with no unique constraint; `Payment.orderId`
  has only a plain index (`schema.prisma:76`). Two concurrent `initiate` calls (double-tap / retry /
  duplicated webhook) both pass the check and each create a PENDING/PAID row.
- Fix: partial unique index `CREATE UNIQUE INDEX ... ON payments("orderId") WHERE status IN ('PENDING','PAID')`;
  catch the resulting P2002 in `create` and translate to `PaymentAlreadyExistsError` (409).
- Files: `services/payment-service/src/application/services/payment.service.ts:84`,
  `services/payment-service/prisma/schema.prisma:46-81`,
  `services/payment-service/src/infrastructure/prisma/payment.prisma.repository.ts:70`.
- Risk: double-charge / duplicate COD record. Priority: **P0.**

**DB-2 — "One primary address / one default payment method" is non-transactional (race → 0 or 2+).**

- Root cause: `setPrimary` does two separate `updateMany` (`unsetPrimary` then `markPrimary`) with no
  transaction and no DB constraint. A crash between them leaves zero primaries (breaks checkout
  default-address resolution); two concurrent calls can leave two.
- Fix: wrap in `prisma.$transaction([...])`; add partial unique index
  `CREATE UNIQUE INDEX ... ON addresses("customerId") WHERE "isPrimary"` (and same for
  `saved_payment_methods."isDefault"`).
- Files: `services/customer-service/src/application/services/address.service.ts:82`,
  `.../payment-method.service.ts:70`,
  `services/customer-service/src/infrastructure/prisma/address.prisma.repository.ts:38`.
- Risk: broken checkout / inconsistent billing default. Priority: **P0.**

### HIGH

**SEC-2 — Depot inventory reserve/consume/release trust the forwarded end-user token.**

- Root cause: these gateway-reachable routes are guarded only by `JwtAuthGuard`/`@Roles` (CUSTOMER in
  reserve-roles, DRIVER in consume-roles); `orderId` is validated only as a UUID, never checked against
  order-service. promo/referral already fixed this with `@Public() + InternalAuthGuard`; depot is the
  last holdout (its code comment claiming parity is now stale).
- Impact: a CUSTOMER can reserve stock against fabricated orderIds → stock-exhaustion / false-OOS DoS;
  a DRIVER can `consume` → irreversible SALE deduction with no real delivery.
- Fix: make the three endpoints `@Public() + @UseGuards(InternalAuthGuard)` and have order-service call
  them with `x-internal-key` (adapter already uses that pattern for confirm/refund).
- Files: `services/depot-service/src/modules/inventory.controller.ts:38-48,113-145`,
  `services/depot-service/src/application/services/inventory.service.ts:316-403`,
  order-service inventory HTTP adapter.
- Risk: inventory integrity / DoS. Priority: **P1 — before wider customer launch.**

**DB-3 / DB-4 — Missing indexes on hot report/list columns.**

- `Order` has no `@@index([createdAt])` though every report + the paginated list filters/sorts on it
  (seq scans as the table grows). `Delivery` has no `@@index([deliveredAt])` though every SLA aggregate
  filters on it. Fix: add `@@index([createdAt])` (+ composites `[status,createdAt]`, `[depotId,createdAt]`)
  and `@@index([deliveredAt])` (+ `[depotId,deliveredAt]`).
- Files: `services/order-service/prisma/schema.prisma:92`, `services/delivery-service/prisma/schema.prisma:143`.
- Risk: latency degradation at scale. Priority: **P1.**

**DB-5 — depot-service: 13+ models store `depotId` with no FK to `Depot` (same DB).**

- Unlike cross-service IDs (correctly loose), these are intra-service and should be FKs: `PricingRule`,
  `PriceOverrideProposal`, `Approval`, `ShiftAssignment`, `DepotTarget`, `CashbookEntry`, `OrderDispute`,
  `MaintenanceItem`, `WholesaleTier`, `Subscription`, `HuddleNote`, `ShiftHandover`, `Incident`,
  `Supplier`, `PurchaseOrder`. Nothing prevents orphan rows / undefined delete semantics.
- Fix: add `@relation` with explicit `onDelete` (Restrict for financial/audit, Cascade for config).
- Files: `services/depot-service/prisma/schema.prisma`. Priority: **P1.**

**DB-6 — Paginated order list uses OFFSET on an unindexed table.**

- `search()` uses `skip:(page-1)*limit` (`order.prisma.repository.ts:220`); compounds with DB-3. The
  cursor pattern already exists elsewhere in the same repo — migrate the OFFSET path or add the index.
- Priority: **P1.**

**QG-1 — No coverage gate; target >90% not enforced (and coverage not measured in CI).**

- CI runs `npm test`, not `test:cov`; no `coverageThreshold` anywhere. Thin-coverage modules: payout-service
  (no e2e; `expense-claim`/`courier-payout` unspecced), newer depot-manager modules
  (cashbook/handover/huddle/maintenance/subscription/wholesale-tier/PO/supplier/roster/approval), and
  the web app has **zero component/e2e tests** (only lib unit tests).
- Fix: add `coverageThreshold` per service, run `test:cov` in CI, add tests for the thin modules and web
  component/E2E (Playwright).
- Files: `.github/workflows/ci.yml:83`, per-service jest config, `apps/web`. Priority: **P1.**

**ARCH-1 — Placeholder business logic in depot CRM aggregates (Constitution `Never: Placeholder/TODO`).**

- `DepotCrmService` returns hardcoded `0`/`[]`/`null` for orderCount, totalSpent, gallonsOnLoan,
  depositHeldIdr, isSubscriber, churnRisk, deposit ledger, recent orders — while the DTO + FE render them
  (depot customer directory 6a/7a/12b shows false zeros).
- Fix: wire order-service + depot-service internal ports (drop-in per the class doc) or hide the unwired
  fields in the FE until wired.
- Files: `services/customer-service/src/application/services/depot-crm.service.ts:77-155`.
- Risk: misleading operational data for depot staff. Priority: **P1/P2.**

### MEDIUM

- **SEC-3 — Gateway has no edge rate limiting; per-service throttler is in-memory (per-instance only).**
  A flood hits every downstream's own limit in parallel; horizontal scaling multiplies effective limits.
  Fix: wire the provisioned `RATE_LIMIT_*` into a gateway limiter + Redis throttler storage before scaling.
  `services/gateway-service/src/app.module.ts`. (Redis container runs but is unused — see OPS-2.)
- **DB-7 — Sequential per-product catalog fetch in checkout hot path** (N round-trips at N cart lines);
  `ProductCatalogPort` has no bulk method though `depotPricing.getPrices` is already batched.
  `order.service.ts:123-132,597`. Fix: add `getProducts(ids[])`.
- **DB-9 — Order list over-fetches full item/history/review graph** per row; give `search()` a lighter select.
- **DB-10 — `VoucherRedemption`/`VoucherGrant` `onDelete: Cascade`** would destroy reconciliation history if
  a voucher is ever hard-deleted (dormant today). Fix: `Restrict` / soft-delete via `active`.
- **DB-11 — Inventory singleton (`productId NULL`) uniqueness only in app code** (NULLs distinct in PG);
  add partial unique index `... ON inventory_items(depotId,itemType) WHERE productId IS NULL`.
- **DB-12 / OPS-1 — Backup has no tested restore path; ≥24h RPO on a money system.** `pg_dumpall` daily,
  size-only sanity check, restore is a comment (no `restore-db.sh`, no drill). Fix: WAL/more-frequent dumps
  for money DBs + a scheduled restore-to-scratch validation. `scripts/backup-db.sh`.
- **DEP-1 — 16 prod dependency vulns** (13 moderate, 3 high), all transitive (postcss←next, qs←express/nest,
  uuid←google-auth). `npm audit fix` clears uuid non-breaking; others need framework bumps. 0 critical in prod.
- **OBS-1 — No APM/metrics/log aggregation.** Only fire-and-forget 5xx webhook (`error-alerter.ts`); logs to
  container stdout. Fix: add metrics (Prometheus/OpenTelemetry) + centralized logs + alerting.
- **REP-1 — Cross-service report gaps render zeros** (`report.service.ts` depotDaily gallonsReturned/Damaged/
  codCollected=0, perCourier=[]). Documented TODO joins; wire or hide.
- **INFRA-1 — No CD pipeline, no rollback procedure, no zero-downtime strategy.** Deploy is manual
  (`up -d --build` + restart). Migrations are a manual host-side step (not idempotent-on-boot). Fix: add a
  deploy workflow, document/script rollback, consider rolling restarts.

### LOW / Informational

- **ARCH-2** — `order.service.ts:489` recomputes loyalty earn rate locally for notification copy (drift risk if
  loyalty `earnRateRupiah` changes). Extract a shared constant or read from loyalty.
- **SEC-4** — Bearer token in `localStorage` (web) — documented, accepted SPA tradeoff; revisit before public launch.
- **DB-14** — Standardize enum `ALTER TYPE ADD VALUE` migrations on the isolated pattern.
- **DATA-1 (environmental, not code)** — This dev stack's manually-inserted demo catalog uses non-UUID product
  IDs (`2222…`) which fail `AddCartItemDto @IsUUID()`, blocking add-to-cart on _this_ stack. The repo seed
  (`scripts/seed.mjs`) creates valid v4 UUIDs via the API; verified a fresh product orders correctly. Reseed
  the stack. No code change required.
- **OPS-2** — Redis container runs but no service imports a Redis client (reserved for future throttler/cache/queue).

---

## Scores (0–100, balanced)

| Dimension                | Score  | Basis                                                                                            |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------ |
| Architecture             | 90     | Clean hexagonal, single-source RBAC, DDD boundaries; minor intra-service FK debt                 |
| Security                 | 62     | Strong fundamentals (JWT/webhook/SQLi/secrets clean) but 1 CRITICAL + 1 HIGH trust-boundary open |
| Performance              | 70     | Healthy bundles; missing hot indexes + N+1 checkout + no cache                                   |
| Scalability              | 55     | In-memory throttler, no Redis/queue/outbox, single Postgres, no horizontal-scale story           |
| Maintainability          | 88     | Uniform structure, strong typing, good tests; a few placeholder/TODO paths                       |
| Accessibility            | 75     | Dual-theme, responsive verified previously; no automated a11y/Lighthouse gate run this pass      |
| Developer Experience     | 82     | Fast gates, good docs (DEPLOY/DATABASE), but no Turbo cache, no coverage gate                    |
| Infrastructure           | 60     | Solid compose+Caddy+backup; no CD/rollback/restore-drill/monitoring                              |
| **Production Readiness** | **58** | Blocked by 3 Criticals + missing ops (monitoring/restore/coverage)                               |
| Overall Quality          | 74     | High craft, held back by security criticals and ops maturity                                     |

**Estimated test coverage:** backend broad (unit+e2e across most services); **web ~logic-only (no component/E2E)**;
overall well below the >90% governance target once the frontend and thin backend modules are counted. Exact %
not gate-enforced (QG-1).

---

## Ranked issues (by business impact)

**Critical (P0):** SEC-1 (payment price-tampering) · DB-1 (double-charge race) · DB-2 (address/default race).
**High (P1):** SEC-2 (inventory trust-boundary DoS) · DB-3/DB-4 (missing indexes) · DB-5 (missing FKs) ·
DB-6 (OFFSET) · QG-1 (coverage gate) · ARCH-1 (placeholder CRM data).
**Medium:** SEC-3 · DB-7/9/10/11/12 · DEP-1 · OBS-1 · REP-1 · INFRA-1.
**Low:** ARCH-2 · SEC-4 · DB-14 · DATA-1 · OPS-2.

## Immediate actions (before launch)

1. Fix SEC-1, DB-1, DB-2 (P0). 2. Fix SEC-2. 3. Add missing indexes (DB-3/4/6). 4. Stand up monitoring +
   alerting. 5. Add + validate a restore drill. 6. Wire coverage gate + raise thin coverage. 7. `npm audit fix`.

## Future improvements

Redis-backed throttler + cache + job queue/outbox; CD pipeline with rollback + rolling restarts; bulk catalog
endpoint; wire the placeholder CRM/report aggregates; web component + Playwright E2E; automated Lighthouse/a11y gate.

## Known risks accepted (documented)

Online payment gateway, OTP SMS, WhatsApp WABA, live GPS, real ML forecast — external-provider wiring deferred
to launch (per project gap-tracker §3), each with a working degraded-mode fallback in code.

---

## Fixes applied in this audit

All changes verified: `prisma validate` ✅, `typecheck` ✅, service tests ✅ (payment 37/37, customer
38/38), full-workspace regression ✅. Migrations are additive (indexes + partial-unique constraints)
with `rollback.sql`; **not yet applied to live PG** — run `npm run db:migrate:prod` on deploy (dedupe
any legacy duplicate primaries first, per the migration note).

| Finding                     | Fix                                                                                                                                                        | Files                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| DB-1 (double-charge race)   | Partial unique index `payments_one_active_per_order` (PENDING/PAID) + P2002→`PaymentAlreadyExistsError` translation in repo `create`; + 2 regression tests | `payment.prisma.repository.ts`, `schema.prisma`, migration `20260718140500_*`, `payment.repository.spec.ts` |
| DB-2 (primary-address race) | `AddressRepository.setPrimaryExclusive` runs the swap in `$transaction`; service uses it; partial unique index `addresses_one_primary_per_customer`        | `address.service.ts`, `address.prisma.repository.ts`, port + fake, migration `20260718141000_*`             |
| DB-3 (order report indexes) | `@@index([createdAt])`, `[status,createdAt]`, `[depotId,createdAt]`                                                                                        | `order-service/schema.prisma`, migration `20260718140000_*`                                                 |
| DB-4 (delivery SLA indexes) | `@@index([deliveredAt])`, `[depotId,deliveredAt]`                                                                                                          | `delivery-service/schema.prisma`, migration `20260718140000_*`                                              |

**Deferred with exact remediation (documented, not applied this pass):** SEC-1, SEC-2 (cross-service,
require order-service coordination changes + live re-verification — see Findings for the precise fix);
DB-5/6/7/9/10/11, QG-1 coverage gate, OBS-1 monitoring, DB-12 restore drill, INFRA-1 CD/rollback.
Same-pattern fix also owed for the **default payment method** race (`payment-method.service.ts:70`,
identical to DB-2).

### Post-fix regression

Full `npm run typecheck` + `npm run lint` + `npm run test` re-run after all edits — all green
(see commit). No behavior regressions; existing suites unchanged and passing.
