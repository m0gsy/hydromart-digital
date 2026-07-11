# Recommendation Service — Design (M-R3.5, Release 3)

**Date:** 2026-07-11
**Status:** Approved
**Slice:** AI Recommendation (Release 3). Heuristic engines now; ML re-ranker deferred behind a documented seam.

## Goal

Give customers relevant product suggestions from real order history, without ML
infrastructure. Three heuristic engines cover water-depot behavior (repeat galon
refills, cross-sell, cold-start): **smart reorder**, **bought-together**, **trending**.

## Non-goals (deferred)

- ML personalized ranking (collaborative filtering / embeddings). No Python
  serving, feature store, GPU, or offline-eval harness in this stack. Deferred
  behind a documented re-ranker seam.
- Lift/PMI-adjusted co-occurrence (MVP uses raw confidence).
- Sub-day trending granularity.

## Shape (mirrors every sibling service)

- `services/recommendation-service`, port **3013**, DB **hydromart_recommendation**
  (14th deployable, 12th DB-backed).
- Clean-Arch/DDD (domain → application/ports → infrastructure/adapters → interface),
  `@hydromart/platform`, service-local Prisma output (`prisma/generated/client`),
  in-memory port fakes so tests need no DB, Swagger `/docs`, Dockerfile,
  `--preserve-symlinks` boot flags, `postbuild` prisma-copy.
- Gateway gains a `recommendations` segment → `RECOMMENDATION_SERVICE_URL`.

## Domain (pure, no DB)

`src/domain/`:

- `reorder.ts` — `scoreReorder({ purchaseCount, lastPurchasedAt }, now)` and
  `rankReorder(rows, now, limit)`. Score = frequency weighted by recency
  (more-recent + more-frequent ranks higher). Deterministic tiebreak: score desc,
  then `lastPurchasedAt` desc, then productId asc.
- `co-buy.ts` — `confidence(coCount, baseCount)` = `coCount / baseCount` (0 when
  base 0); `rankRelated(rows, limit)` sorted confidence desc, coCount desc,
  productId asc.
- `trending.ts` — `rankTrending(dailyRows, { fromDay, limit })` sums per-day counts
  in window, sorted count desc, productId asc. Depot filter applied by caller/repo.

All pure functions, unit-tested directly.

## Read model (own DB, denormalized — queries make no cross-service call)

Prisma models in `hydromart_recommendation`:

- `CustomerProductPurchase` — `customerId`, `productId`, `purchaseCount Int`,
  `lastPurchasedAt DateTime`. `@@unique([customerId, productId])`,
  `@@index([customerId])`. Feeds reorder.
- `ProductCoBuy` — `productId`, `relatedProductId`, `coCount Int`.
  `@@unique([productId, relatedProductId])`, `@@index([productId])`. Stored **both
  directions** on ingest (symmetric). Feeds bought-together. `productId != relatedProductId`.
- `ProductDailySales` — `productId`, `depotId String?`, `day DateTime @db.Date`,
  `count Int`. `@@unique([productId, depotId, day])`. Feeds trending window.
  Depot-scoped rows use the order's `depotId`; a null-depot order tallies a
  `depotId=null` row so global trending still counts it.
- `ProductRef` — `productId @id`, `name`, `sku`, `unit`. Upserted from ingest
  snapshots; enriches responses (no product-service call).
- `IngestedOrder` — `orderId @id`. Idempotency guard: an order already present is
  skipped whole (no double counting on retried COMPLETED or rebuild re-run).

`day` is derived from ingest time (UTC date) at the service layer.

## Data flow — event + admin rebuild

### Live ingest (primary, always-fresh)

- order-service fires on order **COMPLETED** (in `updateStatus`, alongside existing
  loyalty-earn / referral-qualify), **fail-OPEN** (never blocks completion).
- New `RecommendationCoordinationPort` → `recommendation-coordination.http.adapter.ts`
  (native fetch, 5s timeout, `x-internal-key`, disabled when
  `RECOMMENDATION_SERVICE_URL`/`INTERNAL_SERVICE_KEY` blank).
- Endpoint: `POST /api/v1/recommendations/ingest`, `@Public` + `@UseGuards(InternalAuthGuard)`.
- Payload = the order's frozen OrderItem snapshots (already carry
  productId/productName/sku/unit) + customerId + optional depotId:
  ```json
  { "orderId": "...", "customerId": "...", "depotId": "...|null",
    "items": [ { "productId": "...", "productName": "...", "sku": "...", "unit": "..." } ] }
  ```
- Service `ingest(cmd)`:
  1. If `IngestedOrder` has `orderId` → no-op (idempotent).
  2. For each item: upsert `ProductRef`; increment `CustomerProductPurchase`
     (count+1, `lastPurchasedAt=now`); increment `ProductDailySales`
     (productId, depotId, today).
  3. For each unordered pair in the order's item set: increment `ProductCoBuy`
     both directions (`coCount+1`).
  4. Insert `IngestedOrder`.
  All within one `$transaction`.

### Admin rebuild (backfill / recovery)

- `POST /api/v1/recommendations/rebuild`, `@Roles(SUPER_ADMIN)`. Optional `?limit`
  page size.
- Pages a new lean **internal** order-service endpoint
  `GET /api/v1/orders/internal/completed?cursor=&limit=`
  (`@Public` + `@UseGuards(InternalAuthGuard)`, `x-internal-key`), returning
  completed orders **with items** + a `nextCursor` (opaque, e.g. last order id /
  createdAt). recommendation-service re-ingests each order through the same
  idempotent `ingest` path — safe to re-run, converges to correct aggregates.
- Rebuild does NOT truncate first (idempotency guard prevents double counting); a
  future `?reset=true` could wipe + recompute if aggregates ever drift. (Ceiling.)

## Query API

- `GET /api/v1/recommendations/reorder?limit=` — `@Roles(CUSTOMER)`, uses `user.sub`.
  Reorder ranking of that customer's `CustomerProductPurchase`. Empty list when no
  history. Cross-customer isolation (only own rows).
- `GET /api/v1/recommendations/products/:productId/related?limit=` — `@Public`.
  Bought-together for that product. Empty when unseen.
- `GET /api/v1/recommendations/trending?depotId=&days=&limit=` — `@Public`.
  Trending over last `days` (default 30), depot-scoped when `depotId` set (else
  global, summing all depot rows). Empty when no sales.

All responses enrich via `ProductRef`:
`{ productId, name, sku, unit, score }` (score = reorder score / co-buy confidence /
trending count depending on engine). Defaults: `limit` default 10 (cap 50).

## ML upgrade seam (deferred, documented — no premature abstraction)

Each query is **candidate generation → response**. The extension point for a future
ML re-ranker is between those two steps: re-rank heuristic candidates (already a
bounded shortlist) before returning. Documented in the query service as the slot; no
interface/factory built now (single implementation → YAGNI).

## Gateway + env

- gateway: add `recommendations` segment → `RECOMMENDATION_SERVICE_URL`.
- order-service: new `RECOMMENDATION_SERVICE_URL` env; reuses `INTERNAL_SERVICE_KEY`.
- recommendation-service env: `RECOMMENDATION_SERVICE_PORT=3013`, `DATABASE_URL`,
  `JWT_ACCESS_SECRET` (root `.env` fallback), `INTERNAL_SERVICE_KEY`
  (Joi `allow('').default('')`, blank = ingest/rebuild fail-closed on the guard).
- root `.env.example` + infra init add `hydromart_recommendation` + the RECOMMENDATION
  block; `docs/DATABASE.md` service→DB table gains a row.

## Web (apps/web) — one reusable rail, three placements

- `lib/recommendations.ts` — endpoint builders (`endpoints.recommendations.{reorder,
  related,trending}`) + `Recommendation` type. Any pure helper (e.g. limit clamp)
  unit-tested.
- `components/product-rec-rail.tsx` — `<ProductRecRail title endpoint>`: `useAsync`
  fetch → horizontal-scroll list of product cards (name/unit + link to
  `/products/[id]` + add-to-cart reusing existing cart hook). **Hidden entirely
  when the list is empty** (no dead rails). Loading skeleton; error → hidden
  (discovery surface, non-blocking).
- Placements:
  - Reorder rail on home (`/`) and orders list — signed-in only (uses auth token).
  - Related rail on product detail (`/products/[id]`) — public.
  - Trending rail on catalog/browse — public (cold-start for new customers).
- Rail shows `ProductRef` snapshot name; live price shown on the product detail page
  it links to (price resolves server-side at checkout regardless).

## Testing

Backend (in-memory fakes, no DB — sibling pattern):

- Domain: reorder ordering + recency tiebreak; co-buy confidence + zero-base;
  trending window sum + depot filter + out-of-window exclusion.
- Service: ingest updates all four aggregates; ingest idempotent per orderId;
  co-buy symmetric both directions; rebuild pages + re-ingests + converges;
  queries return enriched ranked lists + empty states.
- e2e RBAC: customer reorder 200 + cross-customer isolation; public related/trending
  200; reorder without token 401; ingest right-key 200 / wrong+no key 401; rebuild
  super-admin 200 / customer 403; internal completed feed key-gated.

Web: endpoint builders + pure helper; rail hidden-on-empty behavior if cheaply testable.

## Migration

Initial `hydromart_recommendation` migration + `rollback.sql`. Applied live via
`npm run db:migrate` (Docker up). Additive — no other service schema changes except
order-service's new **read-only** internal endpoint (no order schema change).

## Documented ceilings

- Co-occurrence uses raw confidence, not lift/PMI — popular items dominate related
  lists. Upgrade = lift/PMI adjustment.
- Trending is daily-bucket granularity, summed over a day window (no hourly).
- Single reorder score formula (frequency × recency); not tuned per segment.
- `ProductRef` snapshot may drift from catalog (name); acceptable — rail is
  discovery, price authoritative at checkout.
- Rebuild is append-only + idempotency-guarded (no reset); add `?reset=true` if
  aggregates ever need a clean recompute.
- ML re-ranker deferred behind the documented seam.
- Ingest/rebuild are internal-key-authed (fail-closed guard); order→ingest is
  fail-open so a recommendation outage never blocks order completion.
