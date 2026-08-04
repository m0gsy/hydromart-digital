# Performance baseline

Audit **Q-17**: "latency never measured — no load test, no profiler, no baseline". Without a
recorded starting point, every optimisation in PR 7–9 is a claim rather than a result.

This file is the baseline. It records, per hot path, **what one request costs in round-trips**
— database queries and outbound HTTP calls — before and after the fix, plus the test that
holds the number there. Round-trips are used rather than milliseconds on purpose: they are
measurable in the unit suite on any machine, they are what actually dominates these paths, and
a wall-clock number from a laptop is not comparable to one from the VPS.

Wall-clock is measured separately, against a running stack, with the k6 scripts in
`scripts/load/` — see [Latency](#latency-real-stack) below.

## How to read the table

- **N** = number of items in the request (cart lines, employees on a roster, depots owned).
- **Cost** = round-trips, counted from the fakes/mocks in the unit suite.
- **Pinned by** = the test that fails if the fan-out comes back. This is the ratchet;
  `scripts/check-perf-baseline.mjs` fails CI if a named test disappears or stops asserting.

## Round-trip baseline

| ID | Hot path | Before | After | Pinned by |
|---|---|---|---|---|
| S-1 | Owner dashboard (N depots owned) | 3N HTTP | 3 HTTP | `services/dashboard-service/test/unit/dashboard.service.spec.ts` → `costs three calls for many depots` |
| S-6 | HR performance dashboard (N employees, D depots) | ~3N queries + 2D HTTP | 1 query + D HTTP | `services/hr-service/test/unit/performance.service.spec.ts` → `costs the same whether the dashboard scores 2 staff or 40 (audit S-6)` |
| S-13 | Low-stock listing (network-wide) | every line with a minimum, filtered in JS | 1 SQL comparison | `services/depot-service/test/unit/prisma-repositories.spec.ts` → `scopes low stock to one depot, or to several in one query` |
| S-2 | Checkout (N cart lines) | 7 sequential HTTP | 5 sequential HTTP | `services/order-service/test/unit/order.service.spec.ts` → `prices and reseller status are fetched together` |
| S-22 | `priceLines` (N lines) | 2 sequential HTTP | 1 round of 2 concurrent | same test as S-2 |
| S-3 | `consumeForOrder` (N lines) | 5N + 1 queries | N + 3 queries | `services/depot-service/test/unit/inventory.service.spec.ts` → `reads lines and prior movements once for the whole order` |
| S-4 | `reserveAtomic` (N lines) | 3N queries **inside the lock** | 3 queries | `services/depot-service/test/unit/prisma-repositories.spec.ts` → `locks every line in one statement` |
| S-5 | Recommendation ingest (N lines) | 2N + 1 queries in one transaction | 3 queries | `services/recommendation-service/test/unit/prisma-repositories.spec.ts` → `writes the whole order in one round of statements` |
| S-20 | Forecast ingest (N items) | 3N queries in one transaction | 3 queries | `services/forecast-service/test/unit/prisma-repositories.spec.ts` → `applies an ingest atomically (create branches) and increments revenue/activity` |
| S-7 | Product catalog lookup by ids | N HTTP calls (one per cart line) | 1 batch call, deliberately uncached | `services/product-service/test/unit/product.service.spec.ts` → `resolves many products in one read` |
| S-8 | RBAC matrix read | 1 query per request (~32/min) | 1 query per TTL | `services/auth-service/test/unit/access-matrix.service.spec.ts` → `does not re-read within the ttl` |
| S-9 | `latestDirectCost` (S sales, P orders, L lines) | S x P x L scans | one P x L index pass, then a per-item lookup | `services/depot-service/test/unit/operational-report.service.spec.ts` → `accumulates repeat misses, flags conflicting PO costs and ignores POs received after the sale` |
| S-11 | `depotCustomerAggregates` | whole depot order history in JS | 2 queries: one grouped, one contact snapshot | `services/order-service/test/unit/prisma-repositories.spec.ts` → `depotCustomerAggregates: empty groupBy short-circuits (no contact fetch)` |
| S-12 | `findReorderReminderTargets` | whole order table grouped, filtered in JS | 1 SQL query | `services/order-service/test/unit/prisma-repositories.spec.ts` → `filters the reminder window in SQL` |
| S-14 | Promo analytics | 5 JS passes over full redemption history | 1 grouped query | `services/promo-service/test/unit/promotion.service.spec.ts` → `aggregates all-time usage, UTC buckets, savings, affected orders, and sorted customers` |
| S-15 | `listCurrent()` on order completion | whole commission table | 1 indexed read | `services/payout-service/test/payout.service.spec.ts` → `credits the sale and debits commission at the depot scheme rate` |
| S-18 | `trendingRows` | a year of rows for 10 items | 1 grouped query, limited | `services/recommendation-service/test/unit/prisma-repositories.spec.ts` → `groups and limits in SQL` |
| S-17 | Courier GPS ping | full status history + proof per ping | id + status only | `services/delivery-service/test/unit/delivery.service.spec.ts` → `a ping does not load the history` |
| S-23 | Order read | status history on EVERY read | reports and the stale sweep read none | `services/order-service/test/unit/prisma-repositories.spec.ts` → `does not include history on the report read` |
| S-24 | `deleteLine` | whole movement history loaded | 1 count | `services/depot-service/test/unit/prisma-repositories.spec.ts` → `reads many lines and prior movements in one query each, and counts by type` |
| S-16 | Bulk customer import (N rows) | ~5 round-trips per row | ~3 per row | `services/customer-service/test/unit/customer-import.service.spec.ts` → `pre-registers each phone and points the profile at the importing depot` |
| S-21 | `payroll.generate` | 6 sequential queries | 1 round of 6 concurrent | `services/hr-service/test/unit/payroll.service.spec.ts` → `DAILY base = dailyRate × presentDays; net folds bonus and deductions` |
| S-19 | `requireDepot` (47 call sites) | 1 full-row read per request | 1 existence read, then remembered | `services/depot-service/test/unit/prisma-repositories.spec.ts` → `remembers a depot exists, but never that one does not` |
| S-10 | Batched loops (the sites listed below) | N round-trips each | 1–3 each | `services/depot-service/test/unit/inventory.service.spec.ts` → `reads lines and prior movements once for the whole order` |
| S-25 | HR analytics tail / admin purge timeout | unbounded reads, 30 s timeout | keyset-paged (already, PR 6) + 5 min | `services/admin-service/test/unit/coverage-edges.spec.ts` → `is true only when both are present` |

### S-10 — which loops were batched, and which were left alone

Batched in PR 7: order reserve / release / consume (depot-service), recommendation ingest,
forecast ingest, the owner dashboard's per-depot sources, the HR performance dashboard's
per-employee reads, promotion analytics, trending, reorder reminders, the bulk customer
import's per-row profile writes.

**Left sequential on purpose**, per the audit's own warning: retry loops, the deterministic
lock ordering in `reserveAtomic`, cursor-paged walks (`readAllPages`), and the per-row
importers whose whole point is that row 7 failing does not stop row 8. A bare `Promise.all`
over any of those would be a new bug, not an optimisation.

## Latency (real stack)

Round-trip counts do not tell you whether the thing is fast enough — only that it stopped
being quadratic. For wall-clock, run these against a seeded stack:

```bash
# checkout hot path (existing; DB-7 fan-out)
k6 run scripts/load/checkout.k6.js

# the two dashboards the audit measured at 201 and ~600 calls
k6 run scripts/load/dashboards.k6.js
```

Both print p95 and fail on their thresholds. **Record the numbers here when you run them** —
an empty row below is honest; an invented one is not.

| Date | Commit | Scenario | VUs | p95 | Notes |
|---|---|---|---|---|---|
| _not yet run_ | | | | | needs a seeded VPS-class stack; laptop numbers are not a baseline |

### Profiler

There is still no continuous profiler, and one is not being added here — the cheap version is
already available on the box:

```sql
-- top 20 statements by total time; needs pg_stat_statements loaded (shared_preload_libraries)
SELECT calls, round(total_exec_time::numeric, 1) AS ms, round(mean_exec_time::numeric, 2) AS avg_ms, query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

That is the ops step that turns this file from "counts we assert" into "queries production
actually runs". Q-17 is verified closed in PR 10, once the CI wiring and one recorded run exist.
