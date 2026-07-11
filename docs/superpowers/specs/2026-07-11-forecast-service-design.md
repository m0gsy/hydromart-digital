# Forecast Service — Design (M-R3.6, Release 3, FINAL milestone)

**Date:** 2026-07-11
**Status:** Approved
**Slice:** Predictive Analytics (Release 3). User chose **Demand forecast** first. Heuristic
time-series now (moving-average + linear trend); ML/statistical forecasting (ARIMA/Prophet/ML)
deferred behind a documented re-forecaster seam. Completes Release 3 → whole roadmap.

## Goal

Per-depot per-product **demand forecast** from real completed-order history, without ML
infrastructure. Projects near-term daily unit demand so operators can plan stock (feeds the
inventory reorder / low-stock story). Advisory only — never blocks any flow.

## Non-goals (deferred)

- Statistical/ML forecasting (ARIMA, Prophet, exponential smoothing with seasonality,
  embeddings). No Python serving / feature store / GPU in this stack. Deferred behind a
  documented re-forecaster seam (candidate series → returned series).
- Explicit seasonality / holiday modelling (linear trend + moving average only).
- Reorder point that subtracts live on-hand stock (forecast returns predicted demand;
  reorder suggestion = horizon demand, ignores current stock — documented ceiling).
- Churn / sales-revenue forecasting (other Predictive-Analytics slices; not this milestone).

## Shape (mirrors every sibling service — recommendation-service is the template)

- `services/forecast-service`, port **3014**, DB **hydromart_forecast**
  (15th deployable, 13th DB-backed).
- Clean-Arch/DDD (domain → application/ports → infrastructure/adapters → interface),
  `@hydromart/platform`, service-local Prisma output (`prisma/generated/client`),
  in-memory port fakes so tests need no DB, Swagger `/docs`, Dockerfile,
  `--preserve-symlinks` boot flags, `postbuild` prisma-copy.
- Gateway gains a `forecast` segment → `FORECAST_SERVICE_URL`.

## Domain (pure, no DB)

`src/domain/`:

- `series.ts` — `denseDailySeries(rows, { fromDay, toDay })` fills a contiguous day range
  with 0 for missing days → `number[]` of quantities oldest→newest. UTC day math via
  `Date` epoch-day helpers (`toUtcDay`, `addDays`). Deterministic.
- `moving-average.ts` — `movingAverage(series, window)` = mean of the last `window` values
  (or all if fewer). `0` for empty series.
- `trend.ts` — `linearTrend(series)` least-squares over `(index, value)` → `{ slope, intercept }`
  (slope 0, intercept = mean or 0 when <2 points). `projectAt(trend, index)` = intercept + slope*index.
- `forecast.ts` — `forecastDemand(series, { horizonDays, maWindow })`:
  - `avgDaily = movingAverage(series, maWindow)`, `trend = linearTrend(series)`.
  - Predicted day k (k = 0..horizon-1, future) = `clampNonNeg(round( projectAt(trend, n + k) ))`
    **blended toward `avgDaily`** so a short/noisy history degrades to the average rather than
    a wild extrapolation: `predicted_k = clampNonNeg(round( 0.5*proj + 0.5*avgDaily ))` when
    `n < maWindow*2` else pure projection. (Documented heuristic; tunable.)
  - Returns `{ avgDaily, trendSlope: slope, predictedDaily: number[horizon], predictedTotal,
    reorderSuggestion: predictedTotal }`.
- All pure, unit-tested directly. No `Date.now()` inside domain — caller passes `now`.

## Read model (own DB, denormalized — queries make no cross-service call)

Prisma models in `hydromart_forecast`:

- `ProductDailyDemand` — `productId`, `depotId String?`, `day DateTime @db.Date`,
  `quantity Int`, `orderCount Int`. `@@unique([productId, depotId, day])`,
  `@@index([depotId, day])`, `@@index([productId, depotId])`. Sums UNITS sold per day
  (not just order count — that's the difference from recommendation's ProductDailySales).
  A null-depot order tallies a `depotId=null` row.
- `ProductRef` — `productId @id`, `name`, `sku`, `unit`. Upserted from ingest snapshots;
  enriches responses (no product-service call).
- `IngestedOrder` — `orderId @id`. Idempotency guard: order already present → skipped whole
  (no double counting on retried COMPLETED or rebuild re-run).

`day` = UTC date of the order's completion time (ingest carries `at`, same as recommendation).

## Data flow — event + admin rebuild

### Live ingest (primary, always-fresh)

- order-service fires on order **COMPLETED** (in `updateStatus`, alongside existing
  loyalty-earn / referral-qualify / inventory-consume / recommendation-ingest),
  **fail-OPEN** (never blocks completion; `.catch()` at call site).
- New `ForecastCoordinationPort` → `forecast-coordination.http.adapter.ts` (native fetch,
  5s timeout, `x-internal-key`, disabled when `FORECAST_SERVICE_URL`/`INTERNAL_SERVICE_KEY`
  blank). Mirrors `recommendation-coordination.http.adapter.ts` exactly.
- Endpoint: `POST /api/v1/forecast/ingest`, `@Public` + `@UseGuards(InternalAuthGuard)`.
- Payload — frozen OrderItem snapshots **plus quantity** (new: the recommendation payload
  omitted quantity; forecast needs units):
  ```json
  { "orderId": "...", "depotId": "...|null",
    "items": [ { "productId": "...", "productName": "...", "sku": "...", "unit": "...", "quantity": 3 } ] }
  ```
  (customerId not needed — demand is depot×product×day, not per-customer.)
- Service `ingest(cmd)`:
  1. If `IngestedOrder` has `orderId` → no-op (idempotent).
  2. For each item: upsert `ProductRef`; increment `ProductDailyDemand`
     (`quantity += item.quantity`, `orderCount += 1`) for (productId, depotId, day(at)).
  3. Insert `IngestedOrder`.
  All within one `$transaction` (PK create = concurrent idempotency backstop; a null-depot
  concurrent same-day pair can P2002-rollback the loser — rebuild-recoverable, live fail-open —
  same documented ceiling as recommendation).

### Admin rebuild (backfill / recovery)

- `POST /api/v1/forecast/rebuild`, `@Roles(SUPER_ADMIN)`. Optional `?limit` page size.
- Pages order-service `GET /api/v1/orders/internal/completed?cursor=&limit=` (already exists;
  **its item shape gains `quantity`** — additive, recommendation ignores the extra field).
  Re-ingests each order through the same idempotent path.

## Query API (all @Roles planning-staff — not customer-facing)

`PLANNING_ROLES = [DEPOT_OPERATOR, DEPOT_MANAGER, HEAD_OFFICE, SUPER_ADMIN, FRANCHISE_OWNER]`.

- `GET /api/v1/forecast/demand?depotId=&productId=&historyDays=&horizonDays=` — single
  product forecast at a depot (omit `depotId` = global, sums all depot rows for that product).
  `productId` required. Loads `ProductDailyDemand` in the history window, builds dense series,
  runs `forecastDemand`, enriches with `ProductRef`. Returns
  `{ productId, name, sku, unit, avgDaily, trendSlope, predictedDaily[], predictedTotal,
     reorderSuggestion, history: number[] }`. Empty history → all-zero forecast (not 404).
- `GET /api/v1/forecast/depot/:depotId?historyDays=&horizonDays=&limit=` — planning rollup:
  every product with demand at that depot, each forecast, sorted by `predictedTotal` desc,
  enriched. `limit` default 20 (cap 100). Empty when depot has no sales.

Defaults: `historyDays` default 30 (clamp [7, 365]), `horizonDays` default 7 (clamp [1, 90]),
`maWindow` = min(historyDays, 14).

## ML upgrade seam (deferred, documented — no premature abstraction)

Each query is **candidate series → forecast → response**. The extension point for a future
statistical/ML re-forecaster is `forecastDemand` (swap the heuristic for a fitted model over
the same dense series). Documented in the query service as the slot; no interface/factory now
(single implementation → YAGNI).

## Gateway + env

- gateway: add `forecast` segment → `FORECAST_SERVICE_URL`.
- order-service: new `FORECAST_SERVICE_URL` env; reuses `INTERNAL_SERVICE_KEY`.
- forecast-service env: `FORECAST_SERVICE_PORT=3014`, `DATABASE_URL`, `JWT_ACCESS_SECRET`
  (root `.env` fallback), `INTERNAL_SERVICE_KEY` (Joi `allow('').default('')`, blank =
  ingest/rebuild fail-closed on the guard), `ORDER_SERVICE_URL` (for rebuild feed).
- root `.env.example` + infra init add `hydromart_forecast` + the FORECAST block;
  `docs/DATABASE.md` service→DB table gains a row.

## Web (apps/web) — staff planning console

- `lib/forecast.ts` — endpoint builders (`endpoints.forecast.{demand,depot}`) + `ForecastItem`
  type + one pure helper `trendLabel(slope)` (↑ rising / ↓ falling / → flat, tested).
- New **`/dashboard/forecast`** route (reuses customer-app auth/api/session — NO `apps/admin`):
  depot picker (GET `depots` browse), horizon/history selectors, per-product demand table
  (name/unit, avg daily, trend arrow, predicted total over horizon, reorder suggestion, tiny
  inline history sparkline optional). Gated client-side by new `lib/roles.ts` **`canViewForecast`**
  (PLANNING_ROLES) mirroring forecast-service; server stays authority. Dashboard discovery link.
- Uses `depot/:depotId` rollup endpoint (one call per depot pick).

## Testing (in-memory fakes, no DB — sibling pattern)

- Domain: dense-series gap fill; moving average (partial window); linear trend slope sign +
  flat/single-point; forecastDemand — rising history projects up, empty → zeros, short-history
  blend toward average, non-negative clamp, horizon length.
- Service: ingest sums quantity (not count) into daily demand; ingest idempotent per orderId;
  ProductRef upsert enrich; rebuild pages + re-ingests + converges; demand query global vs
  depot-scoped; depot rollup ranks by predictedTotal; empty states.
- e2e RBAC: planning-role demand/depot 200; customer 403; ingest right-key 200 / wrong+no key
  401; rebuild super-admin 200 / customer 403.
- Web: endpoint builders + `trendLabel` + `canViewForecast`.

## Migration

Initial `0001_init` for `hydromart_forecast` + `rollback.sql`. Applied live via
`npm run db:migrate` (Docker up). Additive elsewhere — order-service only gains `quantity` on
its existing internal feed item shape (read-only, no order schema change) + a new outbound
coordination adapter.

## Documented ceilings

- Heuristic forecast (moving average + linear trend, blended); no seasonality/holidays. Upgrade
  = fitted statistical/ML model at the `forecastDemand` seam.
- Reorder suggestion = horizon demand; ignores live on-hand stock and lead time. Upgrade =
  join depot-service inventory (available) + a lead-time/safety-stock model.
- Daily-bucket granularity (no intra-day).
- `ProductRef` snapshot may drift from catalog (name); acceptable — planning view.
- Rebuild is append-only + idempotency-guarded (no reset); add `?reset=true` if aggregates drift.
- Null-depot concurrent same-day ingest can P2002-rollback the loser (rebuild-recoverable; live
  is fail-open) — same as recommendation.
- Query loads the in-window daily rows into JS (bounded historyDays ≤ 365); upgrade = DB-side
  aggregation if depot×product cardinality grows.
