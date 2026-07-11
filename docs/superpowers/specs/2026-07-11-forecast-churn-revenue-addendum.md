# Forecast Service — Churn + Revenue slices (M-R3.6 addendum)

**Date:** 2026-07-11. Extends `2026-07-11-forecast-service-design.md`. Two more
Predictive-Analytics slices land in the SAME forecast-service (no new service — reuse ingest,
DB, auth, gateway `forecast` segment). Heuristics; documented policy defaults (no PRD rules).

## Ingest contract change (additive, backward-compatible)

order-service → `POST /api/v1/forecast/ingest` body gains two TOP-LEVEL fields; items unchanged:
```json
{ "orderId": "...", "customerId": "...", "depotId": "...|null", "total": 85000,
  "items": [ { "productId": "...", "productName": "...", "sku": "...", "unit": "...", "quantity": 3 } ] }
```
- `total` = `Math.round(order.total)` (integer rupiah: subtotal + delivery fee − discount).
- `customerId` = order.customerId.
The internal completed feed (`GET /orders/internal/completed`) item/order shape also gains
`customerId` + `total` for rebuild. Idempotency unchanged (IngestedOrder guard covers the new
aggregates too — a re-ingested order skips whole).

## New read-model aggregates (migration `0002_churn_revenue`, additive)

- `DepotDailyRevenue` — `depotId String?`, `day @db.Date`, `revenue Int @default(0)`,
  `orderCount Int @default(0)`. `@@unique([depotId, day])`, `@@index([day])`. On ingest:
  `revenue += total`, `orderCount += 1` at (depotId, day(at)). (Int rupiah per day; sums done
  in JS number. Ceiling: a single day's depot revenue > 2.1B IDR would overflow — implausible
  at water-depot scale; upgrade = BigInt.)
- `CustomerActivity` — `customerId @id @db.Uuid`, `depotId String?` (latest order's depot),
  `lastOrderAt DateTime`, `orderCount Int @default(0)`. `@@index([depotId, lastOrderAt])`.
  On ingest: `orderCount += 1`, `lastOrderAt = max(existing, at)`, `depotId = at`'s order depot.

## Domain (pure)

- `churn.ts` — `churnRisk({ lastOrderAt, orderCount }, now, { windowDays }): { daysSince: number;
  riskScore: number; riskBand: 'LOW'|'MEDIUM'|'HIGH' }`.
  - `daysSince = floor((now - lastOrderAt) / day)`.
  - `riskScore = clamp(daysSince / windowDays, 0, 1)` (recency-driven).
  - band: `daysSince >= windowDays` → HIGH; `>= windowDays/2` → MEDIUM; else LOW.
  - Frequent buyers are naturally protected (recent lastOrderAt); orderCount returned for context,
    not (yet) folded into score — documented single-factor ceiling.
- Revenue forecast reuses `forecast.ts` `forecastDemand` on the revenue series (no new engine).

## Query API (added to forecast.controller, base `forecast` — no gateway change)

- `GET /api/v1/forecast/sales?depotId&historyDays&horizonDays` — `@Roles(...PLANNING_ROLES)`.
  Dense daily revenue series (depotId omitted = global sum) → `forecastDemand` → `{ depotId,
  avgDaily, trendSlope, predictedDaily: number[], predictedTotal, history: number[] }` (rupiah).
- `GET /api/v1/forecast/churn?depotId&limit&days` — `@Roles(CHURN_ROLES = [MARKETING,
  DEPOT_MANAGER, HEAD_OFFICE, SUPER_ADMIN])`. Lists customers (depot-scoped when depotId set) by
  `churnRisk` desc → `{ customers: [{ customerId, lastOrderAt, orderCount, daysSince, riskScore,
  riskBand }] }`. `days` overrides windowDays (default env `CHURN_WINDOW_DAYS`=45, clamp [7,180]).
  `limit` default 50 clamp [1,200].

## Web (apps/web)

- Forecast console (`/dashboard/forecast`) gains a **Revenue forecast** card for the picked depot
  (`endpoints.forecast.sales`, avg daily + trend + predicted total over horizon).
- New **`/dashboard/churn`** page — at-risk customer list (customerId, last order, days since,
  risk band pill), gated `canViewChurn` (CHURN_ROLES); feeds CRM re-engagement. Dashboard link.

## Env / infra

- forecast-service: new `CHURN_WINDOW_DAYS` (Joi int default 45).
- No new DB, no new gateway segment, no root infra DB change (reuses `hydromart_forecast`).

## Ceilings

- Churn is single-factor (recency); frequency/monetary not yet in the score (RFM-lite). Upgrade =
  full RFM or a fitted model at the same query seam.
- Revenue is order-total granularity (not per-product margin); daily bucket.
- Same null-depot concurrent-ingest P2002 ceiling as demand (rebuild-recoverable, live fail-open).
