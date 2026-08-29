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
| S-14 | Promo analytics | 5 JS passes over full redemption history | 1 grouped query | `services/promo-service/test/unit/promotion.service.spec.ts` → `aggregates all-time usage, WIB buckets, savings, affected orders, and sorted customers` |
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

## Browser baseline (PR 8)

The same rule applies to the frontend: what one screen costs, and what holds it there.
Requests are counted from the client, so this table is about **HTTP round-trips the browser
makes**, not about queries behind them.

| ID   | Screen / behaviour                                                                        | Before                          | After                              | Pinned by                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-2  | Same GET fired by N components in one paint                                               | N requests                      | 1                                  | `apps/web/test/api-resilience.test.ts` → `concurrent identical GETs cost one round-trip`                                                                                                                                                                                                  |
| F-2  | Reference data (depot list, categories, capability matrix, favourites) re-read per screen | 1 per screen                    | 1 per TTL, dropped by any mutation | `apps/web/test/api-resilience.test.ts` → `getCached serves reference data from memory within its TTL` · `any mutation drops the cache, so the next read is fresh`                                                                                                                         |
| F-7  | Cart quantity change                                                                      | 2 (PUT + GET)                   | 1                                  | `apps/web/test/cart-round-trips.test.tsx` → `a quantity change is one round-trip`                                                                                                                                                                                                         |
| F-7  | Cart add-on tap                                                                           | 3 (POST + GET + GET)            | 1                                  | `apps/web/test/cart-round-trips.test.tsx` → `adding a recommendation is one round-trip`                                                                                                                                                                                                   |
| F-13 | Navigating between shop pages                                                             | +1 `GET /cart` per navigation   | 0                                  | `apps/web/test/cart-round-trips.test.tsx` → `the cart is not re-read on every navigation`                                                                                                                                                                                                 |
| F-13 | Signed-in home, repeat visit within the TTL                                               | 8 requests                      | 3                                  | same `getCached` tests as F-2                                                                                                                                                                                                                                                             |
| F-12 | `/hq/search`, per debounced keystroke                                                     | 130 rows fetched, matched in JS | 30 rows, matched in SQL            | `services/auth-service/test/unit/infra-branches.spec.ts` → `matches the staff search term against name or phone in the query, not in memory` · `services/order-service/test/unit/prisma-repositories.spec.ts` → `matches an order-number term in the query, trimmed and case-insensitive` |
| F-16 | Promo screen while a countdown runs                                                       | whole page re-rendered 60×/min  | one leaf                           | _(no test — a render count is not observable without a profiler; the interval's owner is the assertion)_                                                                                                                                                                                  |
| F-3  | Any request against a hung upstream                                                       | unbounded wait                  | 408 at 15 s                        | `apps/web/test/api-resilience.test.ts` → `a request that never answers is aborted and surfaces as 408, not a hung promise`                                                                                                                                                                |

Bundle weight is NOT in this table. `next build` prints per-route First Load JS, and that is
the number to record — but it is only comparable between two runs of the same Next version on
the same machine, so a figure copied here would rot faster than it helps. What PR 8 removed is
stated instead, in the commits: framer-motion (~110 KB), the second i18n dictionary on every
route, the Phosphor barrel, and four always-mounted components that are now `next/dynamic`.

## Latency (real stack)

Round-trip counts do not tell you whether the thing is fast enough — only that it stopped
being quadratic. For wall-clock, run these against a seeded stack:

```bash
# checkout hot path (existing; DB-7 fan-out)
k6 run scripts/load/checkout.k6.js

# the two dashboards the audit measured at 201 and ~600 calls
k6 run scripts/load/dashboards.k6.js
```

Both print p95 and fail on their thresholds. **The rows below are written by the run itself**
— `.github/workflows/load.yml` calls `node scripts/check-perf-baseline.mjs --record` with k6's
own `--summary-export` JSON and pushes the result. Nobody has to remember. Times are
milliseconds, to k6's own two decimals so a row can be diffed against the run log directly.

`Run` is a GitHub Actions run id: `https://github.com/m0gsy/hydromart-digital/actions/runs/<id>`.
`N` is the **fan-out width the run actually exercised** — cart lines for checkout, owned depots
for the franchise dashboard, employees scored for the performance dashboard. Read the p95
column only together with `N`: every scenario here exists to show a per-item cost stopped
multiplying, and a latency with no width beside it cannot show that.

| Date | Run | Commit | Scenario | VUs | N | Iterations | OK | p50 ms | p90 ms | p95 ms | Host |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-24 | 32686490758 | `4dc0ed92` | checkout | 10 | ? | 864 | 100.00% | 263.31 | 443.43 | 564.43 | gh-ubuntu-24.04 |
| 2026-08-24 | 32686490758 | `4dc0ed92` | franchise dashboard | 10 | 0 | 4399 | 100.00% | 25.04 | 95.45 | 125.95 | gh-ubuntu-24.04 |
| 2026-08-24 | 32686490758 | `4dc0ed92` | performance dashboard | 10 | ? | 4399 | 100.00% | 87.73 | 128.92 | 148.57 | gh-ubuntu-24.04 |
| 2026-08-29 | 33263857699 | `e927e86c` | checkout | 10 | ? | 1027 | 100.00% | 270.59 | 489.06 | 586.77 | gh-ubuntu-24.04 |
| 2026-08-29 | 33263857699 | `e927e86c` | franchise dashboard | 10 | 0 | 8453 | 100.00% | 17.27 | 40.18 | 54.28 | gh-ubuntu-24.04 |
| 2026-08-29 | 33263857699 | `e927e86c` | performance dashboard | 10 | ? | 8453 | 100.00% | 45.57 | 66.06 | 76.95 | gh-ubuntu-24.04 |

Both checkout rows read `N = ?` because NEITHER run emitted `checkout_cart_lines` —
the metric is younger than both (`gh run view <id> --log | grep -c checkout_cart_lines`
returns 0 for 32686490758 and for 33263857699). They first said `N = 3`, inferred from
the scenario's default env, in the same commit whose own rule is that a row can never
claim a width the run did not actually use. Inferring it is exactly the thing the column
was added to prevent, so the cells say `?` until a run measures one.

The `N = 0` and `N = ?` cells are not formatting gaps, they are the finding — see
"the franchise rows measure an empty page" below. Rows recorded from now on cannot carry
`N = 0`: `--record` refuses to write one.

### What these numbers can and cannot claim (audit Q-17)

**The machine.** Every row above was produced on a GitHub-hosted `ubuntu-latest` runner
(image `ubuntu-24.04`, measured from the run log) — NOT on the VPS and NOT on a laptop. One
runner holds the whole stack: Postgres, the gateway, eighteen services, the seed, and k6
itself, all competing for the same cores. The `Host` column records that shape per row,
because GitHub changes runner sizing and two rows from different hardware are not a series.

So:

- **Comparable to each other.** Same workflow, same compose stack, same shape of box. A row
  that doubles against the rows above is a regression worth opening — that is what this
  table is for, and it is why the k6 thresholds were tightened to ~4x the observation
  (see the M22 note in `scripts/load/dashboards.k6.js`).
- **NOT a production SLO.** k6 and the whole stack share one host here, so these numbers
  carry contention production does not have — and lack the network, the disk, the real data
  volume and the concurrent real traffic that it does. Do not quote 564ms of checkout p95 to
  a customer.
- **NOT a capacity number.** 10 VUs for 60s against a seeded shelf of one million units is a
  fan-out probe, not a saturation test. Nothing here says what the box holds at peak.

**The franchise rows measure an empty page.** Both green runs printed, in their own logs,
`WARN: this owner has 0 depots — S-1 fan-out is not exercised.` — and both reported the
franchise threshold PASSED anyway. The cause, measured: `load.yml` mints `TOKEN` with
`scripts/load/mint-tokens.mjs --staff`, which signs `role: 'SUPER_ADMIN'`, and
`/dashboard/franchise` scopes to depots the caller **owns**. A super-admin owns none. So
125.95ms and 54.28ms are the cost of rendering nothing, and a genuine S-1 regression — three
HTTP calls per depot coming back — multiplies by zero and cannot move them. The threshold on
that metric is a gate that cannot go red.

The fix is in the minting, not here: the seed already creates two WARALABA depots with real
owners (`BDG-01`, `SBY-01`), so minting the dashboards token for one of those owners turns the
scenario back on. Until that happens, `--record` writes no franchise row (`N = 0` is refused),
so the table cannot accumulate more measurements of an empty page.

The performance rows carry `N = ?` for a smaller reason: those runs predate the width metric.
Later rows will state the roster size, and it matters — S-6 was audited on a 200-person depot,
while the seed creates a handful of staff, so 76.95ms is not evidence about the case the
optimisation was for.

**Only one width has ever been sampled.** `load.yml` never sets `CART_LINES`, so every
checkout row is `N = 3`. The claim these scripts were written to defend is that p95 stays
_flat_ as N grows; one width cannot show flatness. Two runs at, say, `CART_LINES` 3 and 12
would — that is a workflow change, not a script one.

**What the first green run cost to get.** Eleven of the twelve runs before it were red, and
none of them on latency: the seeded shelf ran out mid-run (`ORDER_INSUFFICIENT_STOCK`, run
32661288514, the scheduled Sunday run of 2026-08-23), and then product-service rate-limited
order-service's catalog reads, which the adapter rendered as a bare `HTTP 500 INTERNAL_ERROR`
on `/api/v1/cart/items` (run 32685423425). Both were setup faults wearing a latency job's
clothes; both are fixed in `load.yml` (`SEED_STOCK_QTY`, the test stack's `RATE_LIMIT_MAX`)
and both now abort with a message that names the real cause.

**Still owed, and only an operator can do it.** A VPS-class run. The checkout scenario places
real orders and moves real stock, so against production it is not a measurement — it is fake
sales in the ledger and a depot whose available quantity no longer matches its shelf. Use a
seeded copy of the stack, raise the limiter for the duration:

```bash
RATE_LIMIT_MAX=100000 docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d gateway
```

and **put it back afterwards** — a load-test setting left behind is a denial-of-service budget
left open. Both scripts abort loudly on a 429 rather than folding it into the failure rate
(CI-12), so a forgotten step cannot quietly become "the p95". Record such a run with a `Host`
that says VPS, so it is never mistaken for one of the runner rows. If `pg_stat_statements` is
loaded, paste the top statements alongside it.

### Profiler

There is still no continuous profiler, and one is not being added here — the cheap version is
already available on the box:

```sql
-- top 20 statements by total time; needs pg_stat_statements loaded (shared_preload_libraries)
SELECT calls, round(total_exec_time::numeric, 1) AS ms, round(mean_exec_time::numeric, 2) AS avg_ms, query
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

That is the ops step that turns this file from "counts we assert" into "queries production
actually runs", and it is the one piece of Q-17 still outstanding. The CI wiring and the
recorded run both exist now — see the Latency table — so what remains is a profile of the
real box, which no workflow can take for you.
