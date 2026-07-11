# Recommendation Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `recommendation-service` (heuristic reorder / bought-together / trending) fed by order history, wired from order-service on COMPLETED, surfaced as three web rails.

**Architecture:** New DB-per-service NestJS microservice (Clean-Arch/DDD) owning a denormalized read model in `hydromart_recommendation`. order-service pushes each COMPLETED order's frozen line-item snapshots to an internal-key-authed ingest endpoint (fail-open); an admin rebuild pages a new internal completed-orders feed on order-service. Pure domain functions rank candidates; queries enrich from a local `ProductRef` snapshot (no cross-service call at read time).

**Tech Stack:** NestJS 10, Prisma (service-local generated client), `@hydromart/platform`, Joi env validation, Jest + ts-jest (in-memory port fakes, no DB), Next.js 15 App Router + vitest (web).

## Global Constraints

- Port **3013**; DB **hydromart_recommendation**; gateway segment **recommendations**.
- Clean-Arch/DDD layering: `domain/` (pure) → `application/` (services, ports, tokens) → `infrastructure/` (prisma repos, http adapters) → `modules/` (controllers, Nest module) — mirror `services/referral-service`.
- Prisma generator `output = "./generated/client"` (service-local); import client via `../../../prisma/generated/client` from `src/infrastructure/prisma/`.
- `postbuild` copies generated client into dist (`node ../../packages/platform/scripts/copy-prisma-to-dist.mjs`); `start`/`start:prod` use `node --preserve-symlinks dist/src/main.js`.
- Shared secrets (`JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_KEY`) resolve from repo-root `.env` fallback; per-service `.env` keeps a synced copy for ts-jest+Prisma e2e. `INTERNAL_SERVICE_KEY` Joi `allow('').default('')` (blank = internal guard fails closed).
- Money/counts are integers where applicable; no floats in the read model.
- All coordination from order-service is **fail-OPEN** (never blocks order completion).
- Tests need **no database** — every port has an in-memory fake; e2e seeds `process.env` before ConfigModule validates (validationSchema validates process.env, not `load()`).
- Reference sibling for cloning: `services/referral-service` (most recent same-shape, has internal + customer + staff routes). CRM `notification.controller` shows the `@Public + InternalAuthGuard` internal-route pattern.

---

### Task 1: Scaffold recommendation-service (boots, health 200)

**Files:**
- Create: `services/recommendation-service/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `.eslintrc.cjs`, `jest.config.js` (or `test/jest-e2e.json` per sibling), `Dockerfile`, `.env.example`
- Create: `services/recommendation-service/src/main.ts`, `src/app.module.ts`, `src/config/env.validation.ts`, `src/config/recommendation-config.service.ts`
- Create: `services/recommendation-service/prisma/schema.prisma`
- Create: `services/recommendation-service/src/modules/health.controller.ts` (or reuse sibling health pattern)

**Interfaces:**
- Produces: a bootable Nest app on `RECOMMENDATION_SERVICE_PORT` (default 3013) with `GET /health` 200 and Swagger `/docs`; `RecommendationConfigService` exposing `port`, `databaseUrl`, `jwtAccessSecret`, `internalServiceKey`, `orderServiceUrl` (for rebuild).

- [ ] **Step 1:** Copy `services/referral-service` to `services/recommendation-service` (files above); rename `Referral*`→`Recommendation*`, `referral`→`recommendation`, `REFERRAL_`→`RECOMMENDATION_`, port `3011`→`3013`, DB name→`hydromart_recommendation`. Delete referral domain/application/infrastructure/modules business files (kept structure, config, main, module shell). Config keys: `RECOMMENDATION_SERVICE_PORT=3013`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `INTERNAL_SERVICE_KEY` (`allow('').default('')`), `ORDER_SERVICE_URL` (`allow('').default('')`).
- [ ] **Step 2:** Replace `prisma/schema.prisma` datasource `url = env("DATABASE_URL")`, generator `output = "./generated/client"`, and models:

```prisma
model CustomerProductPurchase {
  id             String   @id @default(uuid()) @db.Uuid
  customerId     String   @db.Uuid
  productId      String   @db.Uuid
  purchaseCount  Int      @default(0)
  lastPurchasedAt DateTime
  @@unique([customerId, productId])
  @@index([customerId])
  @@map("customer_product_purchases")
}

model ProductCoBuy {
  id               String @id @default(uuid()) @db.Uuid
  productId        String @db.Uuid
  relatedProductId String @db.Uuid
  coCount          Int    @default(0)
  @@unique([productId, relatedProductId])
  @@index([productId])
  @@map("product_co_buys")
}

model ProductDailySales {
  id        String   @id @default(uuid()) @db.Uuid
  productId String   @db.Uuid
  depotId   String?  @db.Uuid
  day       DateTime @db.Date
  count     Int      @default(0)
  @@unique([productId, depotId, day])
  @@index([day])
  @@map("product_daily_sales")
}

model ProductRef {
  productId String @id @db.Uuid
  name      String
  sku       String
  unit      String
  @@map("product_refs")
}

model IngestedOrder {
  orderId    String   @id @db.Uuid
  ingestedAt DateTime @default(now())
  @@map("ingested_orders")
}
```

- [ ] **Step 3:** `npm install` at repo root (workspace picks up new package). Run `npx prisma generate --schema services/recommendation-service/prisma/schema.prisma`. Expected: client generated at `services/recommendation-service/prisma/generated/client`.
- [ ] **Step 4:** `npm run build -w @hydromart/recommendation-service` (adjust to actual package name). Expected: dist emitted, postbuild copies prisma client. `npx tsc -p services/recommendation-service/tsconfig.json --noEmit` clean.
- [ ] **Step 5:** Commit `chore(rec): scaffold recommendation-service (port 3013, hydromart_recommendation)`.

---

### Task 2: Pure domain ranking (reorder / co-buy / trending)

**Files:**
- Create: `services/recommendation-service/src/domain/reorder.ts`, `co-buy.ts`, `trending.ts`
- Test: `services/recommendation-service/test/unit/domain.spec.ts`

**Interfaces:**
- Produces:
  - `reorder.ts`: `type PurchaseRow = { productId: string; purchaseCount: number; lastPurchasedAt: Date }`; `scoreReorder(row: PurchaseRow, now: Date): number`; `rankReorder(rows: PurchaseRow[], now: Date, limit: number): Array<{ productId: string; score: number }>`
  - `co-buy.ts`: `confidence(coCount: number, baseCount: number): number`; `type CoBuyRow = { relatedProductId: string; coCount: number }`; `rankRelated(rows: CoBuyRow[], baseCount: number, limit: number): Array<{ productId: string; score: number }>`
  - `trending.ts`: `type DailyRow = { productId: string; day: Date; count: number }`; `rankTrending(rows: DailyRow[], fromDay: Date, limit: number): Array<{ productId: string; score: number }>`

- [ ] **Step 1:** Write `test/unit/domain.spec.ts` (FAILING):

```ts
import { scoreReorder, rankReorder } from '../../src/domain/reorder';
import { confidence, rankRelated } from '../../src/domain/co-buy';
import { rankTrending } from '../../src/domain/trending';

const now = new Date('2026-07-11T00:00:00Z');

describe('reorder', () => {
  it('ranks frequent+recent above rare+old', () => {
    const rows = [
      { productId: 'a', purchaseCount: 10, lastPurchasedAt: new Date('2026-07-10T00:00:00Z') },
      { productId: 'b', purchaseCount: 1, lastPurchasedAt: new Date('2026-01-01T00:00:00Z') },
    ];
    expect(rankReorder(rows, now, 10).map((r) => r.productId)).toEqual(['a', 'b']);
  });
  it('recency breaks a frequency tie', () => {
    const rows = [
      { productId: 'old', purchaseCount: 5, lastPurchasedAt: new Date('2026-01-01T00:00:00Z') },
      { productId: 'new', purchaseCount: 5, lastPurchasedAt: new Date('2026-07-10T00:00:00Z') },
    ];
    expect(rankReorder(rows, now, 10)[0].productId).toBe('new');
  });
  it('honors limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ productId: `p${i}`, purchaseCount: i + 1, lastPurchasedAt: now }));
    expect(rankReorder(rows, now, 2)).toHaveLength(2);
  });
});

describe('co-buy', () => {
  it('confidence is co/base, 0 when base 0', () => {
    expect(confidence(3, 6)).toBeCloseTo(0.5);
    expect(confidence(3, 0)).toBe(0);
  });
  it('ranks by confidence then coCount', () => {
    const rows = [
      { relatedProductId: 'x', coCount: 2 },
      { relatedProductId: 'y', coCount: 5 },
    ];
    expect(rankRelated(rows, 10, 10).map((r) => r.productId)).toEqual(['y', 'x']);
  });
});

describe('trending', () => {
  const from = new Date('2026-07-01T00:00:00Z');
  it('sums in-window per product and ranks desc', () => {
    const rows = [
      { productId: 'a', day: new Date('2026-07-02'), count: 3 },
      { productId: 'a', day: new Date('2026-07-05'), count: 4 },
      { productId: 'b', day: new Date('2026-07-03'), count: 5 },
    ];
    expect(rankTrending(rows, from, 10).map((r) => r.productId)).toEqual(['a', 'b']);
  });
  it('excludes rows before fromDay', () => {
    const rows = [
      { productId: 'a', day: new Date('2026-06-01'), count: 100 },
      { productId: 'b', day: new Date('2026-07-02'), count: 1 },
    ];
    expect(rankTrending(rows, from, 10).map((r) => r.productId)).toEqual(['b']);
  });
});
```

- [ ] **Step 2:** Run `npx jest -c services/recommendation-service/jest.config.js domain` → FAIL (modules not found).
- [ ] **Step 3:** Implement:

```ts
// src/domain/reorder.ts
export type PurchaseRow = { productId: string; purchaseCount: number; lastPurchasedAt: Date };
const HALF_LIFE_DAYS = 30;
export function scoreReorder(row: PurchaseRow, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - row.lastPurchasedAt.getTime()) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS); // 1 fresh -> 0.5 at 30d
  return row.purchaseCount * (0.5 + 0.5 * recency); // frequency, recency-weighted, never below half
}
export function rankReorder(rows: PurchaseRow[], now: Date, limit: number) {
  return rows
    .map((r) => ({ productId: r.productId, score: scoreReorder(r, now), _at: r.lastPurchasedAt }))
    .sort((a, b) => b.score - a.score || b._at.getTime() - a._at.getTime() || a.productId.localeCompare(b.productId))
    .slice(0, limit)
    .map(({ productId, score }) => ({ productId, score }));
}
```

```ts
// src/domain/co-buy.ts
export type CoBuyRow = { relatedProductId: string; coCount: number };
export function confidence(coCount: number, baseCount: number): number {
  return baseCount > 0 ? coCount / baseCount : 0;
}
export function rankRelated(rows: CoBuyRow[], baseCount: number, limit: number) {
  return rows
    .map((r) => ({ productId: r.relatedProductId, score: confidence(r.coCount, baseCount), _co: r.coCount }))
    .sort((a, b) => b.score - a.score || b._co - a._co || a.productId.localeCompare(b.productId))
    .slice(0, limit)
    .map(({ productId, score }) => ({ productId, score }));
}
```

```ts
// src/domain/trending.ts
export type DailyRow = { productId: string; day: Date; count: number };
export function rankTrending(rows: DailyRow[], fromDay: Date, limit: number) {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (r.day.getTime() < fromDay.getTime()) continue;
    totals.set(r.productId, (totals.get(r.productId) ?? 0) + r.count);
  }
  return [...totals.entries()]
    .map(([productId, score]) => ({ productId, score }))
    .sort((a, b) => b.score - a.score || a.productId.localeCompare(b.productId))
    .slice(0, limit);
}
```

- [ ] **Step 4:** Run jest → PASS.
- [ ] **Step 5:** Commit `feat(rec): pure ranking domain (reorder/co-buy/trending)`.

---

### Task 3: Read-model ports, Prisma repos, in-memory fakes

**Files:**
- Create: `src/application/ports/recommendation.repository.ts` (port interfaces), `src/application/tokens.ts`
- Create: `src/infrastructure/prisma/prisma.service.ts` (clone sibling), `src/infrastructure/prisma/recommendation.prisma.repository.ts`
- Create: `test/support/fakes.ts` (in-memory repo fake)

**Interfaces:**
- Produces port `RecommendationRepository`:
  ```ts
  type IngestItem = { productId: string; productName: string; sku: string; unit: string };
  type IngestCommand = { orderId: string; customerId: string; depotId: string | null; items: IngestItem[]; at: Date };
  interface RecommendationRepository {
    hasIngested(orderId: string): Promise<boolean>;
    applyIngest(cmd: IngestCommand): Promise<void>;                 // idempotent-guarded by caller; does all 4 aggregate writes + IngestedOrder in one tx
    reorderRows(customerId: string): Promise<PurchaseRow[]>;
    relatedRows(productId: string): Promise<{ rows: CoBuyRow[]; baseCount: number }>; // baseCount = purchaseCount total for productId (sum of coCount is NOT base; base = times productId itself bought). Use ProductDailySales sum for productId as base proxy, or a dedicated counter — see step note.
    trendingRows(depotId: string | null, fromDay: Date): Promise<DailyRow[]>;
    productRefs(ids: string[]): Promise<Map<string, { name: string; sku: string; unit: string }>>;
  }
  ```
  - Token `RECOMMENDATION_TOKENS.Repository`.

> **Base-count note:** "times productId bought" = sum of `ProductDailySales.count` for that productId across all depots (or a dedicated `ProductRef.buyCount`). Simplest: add `buyCount Int @default(0)` to `ProductRef` incremented per ingest occurrence; `relatedRows` returns it as `baseCount`. **Add that column now** (amend Task 1 schema / migration accordingly).

- [ ] **Step 1:** Amend `ProductRef` model to add `buyCount Int @default(0)` and regenerate client.
- [ ] **Step 2:** Write `test/support/fakes.ts` — `FakeRecommendationRepository implements RecommendationRepository` backed by arrays/Maps mirroring the prisma writes (increment counts, symmetric co-buy both directions, daily bucket by `at` UTC date, upsert refs + buyCount, ingested set). Expose seed helpers.
- [ ] **Step 3:** Implement `recommendation.prisma.repository.ts`:
  - `applyIngest` in `this.prisma.$transaction(async (tx) => {...})`: for each item `tx.customerProductPurchase.upsert` (increment `purchaseCount`, set `lastPurchasedAt`), `tx.productRef.upsert` (set name/sku/unit, `buyCount: { increment: 1 }`), `tx.productDailySales.upsert` (unique productId+depotId+day, `count: { increment: 1 }`); for each unordered pair `(a,b)` write both `(a→b)` and `(b→a)` via `tx.productCoBuy.upsert` `coCount: { increment: 1 }`; `tx.ingestedOrder.create`.
  - `reorderRows` → `findMany` where customerId, map to `PurchaseRow`.
  - `relatedRows` → `productCoBuy.findMany` where productId (map to `CoBuyRow`) + `productRef.findUnique` buyCount as baseCount (0 if missing).
  - `trendingRows` → `productDailySales.findMany` where `day >= fromDay` and (depotId set ? `depotId` : no filter), map to `DailyRow`.
  - `productRefs` → `findMany` where `productId in ids`, build Map.
  Prisma `Date` for `day`: construct UTC midnight from `cmd.at`.
- [ ] **Step 4:** `npx tsc -p services/recommendation-service/tsconfig.json --noEmit` clean.
- [ ] **Step 5:** Commit `feat(rec): repository port + prisma adapter + fake`.

---

### Task 4: RecommendationService (ingest + queries) + unit tests

**Files:**
- Create: `src/application/services/recommendation.service.ts`
- Test: `test/unit/recommendation.service.spec.ts`

**Interfaces:**
- Produces `RecommendationService`:
  ```ts
  ingest(cmd: IngestCommand): Promise<void>;                       // idempotent: hasIngested short-circuits
  reorder(customerId: string, limit: number): Promise<RecItem[]>;
  related(productId: string, limit: number): Promise<RecItem[]>;
  trending(depotId: string | null, days: number, limit: number, now?: Date): Promise<RecItem[]>;
  // type RecItem = { productId: string; name: string; sku: string; unit: string; score: number };
  ```
- Consumes: `RecommendationRepository`, domain rank fns. `limit` clamped [1,50]; `days` clamped [1,365].

- [ ] **Step 1:** Write `test/unit/recommendation.service.spec.ts` (FAILING) using `FakeRecommendationRepository`:
  - ingest of `{items:[a,b,c]}` → reorder returns all 3 for that customer; co-buy symmetric (related(a) includes b and c); trending includes a,b,c today.
  - ingest same orderId twice → counts unchanged (idempotent).
  - reorder for a different customer → empty.
  - related(unseen) → empty; trending with 0 sales → empty.
  - responses enriched with name/sku/unit from refs, sorted by domain ranking, respect limit.
- [ ] **Step 2:** Run jest → FAIL.
- [ ] **Step 3:** Implement service: `ingest` calls `hasIngested`→return if true, else `applyIngest`. Queries fetch rows, run domain rank fn, then `productRefs` for the ranked ids, map to `RecItem` (skip ids missing a ref). `trending` computes `fromDay = utcMidnight(now) - (days-1) days`.
- [ ] **Step 4:** Run jest → PASS.
- [ ] **Step 5:** Commit `feat(rec): recommendation service (idempotent ingest + queries)`.

---

### Task 5: Controllers + RebuildService + e2e RBAC

**Files:**
- Create: `src/modules/recommendation.controller.ts` (query + rebuild), `src/modules/ingest.controller.ts` (internal), `src/application/services/rebuild.service.ts`, `src/application/ports/order-feed.port.ts`, `src/infrastructure/http/order-feed.http.adapter.ts`
- Modify: `src/app.module.ts` (wire providers/controllers/tokens)
- Test: `test/e2e/recommendation.e2e.spec.ts`

**Interfaces:**
- Routes (all under global prefix `api/v1`):
  - `POST /recommendations/ingest` — `@Public()` + `@UseGuards(InternalAuthGuard)`; body `{orderId, customerId, depotId?, items:[{productId,productName,sku,unit}]}` → `service.ingest`.
  - `POST /recommendations/rebuild` — `@Roles(Role.SUPER_ADMIN)`; optional `?limit` → `rebuild.run(limit)`.
  - `GET /recommendations/reorder?limit=` — `@Roles(Role.CUSTOMER)`; `service.reorder(req.user.sub, limit)`.
  - `GET /recommendations/products/:productId/related?limit=` — `@Public()`.
  - `GET /recommendations/trending?depotId=&days=&limit=` — `@Public()`.
- `OrderFeedPort.fetchCompleted(cursor: string | null, limit: number): Promise<{ orders: IngestCommand[]; nextCursor: string | null }>` — http adapter GET `${ORDER_SERVICE_URL}/api/v1/orders/internal/completed?cursor=&limit=` with `x-internal-key`; maps each order's items to `IngestCommand` (`at = order.completedAt ?? updatedAt`). Blank URL/key → returns empty page.
- `RebuildService.run(limit)` loops pages until `nextCursor === null`, calling `service.ingest` per order (idempotent).

- [ ] **Step 1:** Write e2e (FAILING) — boot app with `FakeRecommendationRepository` + `FakeOrderFeed`, seed `process.env.INTERNAL_SERVICE_KEY` + `JWT_ACCESS_SECRET` before compile; sign JWTs via ConfigService secret (see referral e2e). Assert: ingest right-key 200 / wrong+no key 401; reorder with customer token 200 (own items only, cross-customer isolation); reorder no token 401; related/trending public 200; rebuild super-admin 200 (pulls fake feed → data queryable) / customer 403.
- [ ] **Step 2:** Run e2e → FAIL.
- [ ] **Step 3:** Implement controllers, `RebuildService`, `OrderFeedPort` + http adapter + fake; wire `app.module.ts` (mirror referral module: global JWT guard + RolesGuard from platform, InternalAuthGuard provided). Route order: static `reorder`/`trending`/`rebuild`/`ingest` before any `:param` route; `products/:productId/related` is unambiguous.
- [ ] **Step 4:** Run e2e → PASS. Full service test run green; `npx tsc --noEmit` + eslint (`npx eslint "services/recommendation-service/src/**/*.ts" "services/recommendation-service/test/**/*.ts"`) clean.
- [ ] **Step 5:** Commit `feat(rec): controllers (ingest/rebuild/queries) + order-feed rebuild + e2e RBAC`.

---

### Task 6: order-service wiring (internal completed feed + fire-on-COMPLETED)

**Files:**
- Create: `services/order-service/src/infrastructure/http/recommendation-coordination.http.adapter.ts`, `src/application/ports/recommendation-coordination.port.ts`
- Modify: `src/application/services/order.service.ts` (fire in `updateStatus` when `to===COMPLETED`), `src/application/tokens.ts`, `src/modules/order.module.ts`, `src/modules/order.controller.ts` (new internal completed feed route), `src/config/env.validation.ts` + `order-config.service.ts` (`RECOMMENDATION_SERVICE_URL`)
- Test: `test/unit/order.service.spec.ts` (recommendation fired on COMPLETED), `test/e2e/order.e2e.spec.ts` (internal feed key-gated)

**Interfaces:**
- `RecommendationCoordinationPort.recordCompleted(order): Promise<void>` — http adapter POST `${RECOMMENDATION_SERVICE_URL}/api/v1/recommendations/ingest` with `x-internal-key`, body from order snapshot (`orderId, customerId, depotId, items` mapped from OrderItem snapshots), 5s timeout, **fail-OPEN** (swallow all), disabled when URL/key blank.
- New order route `GET /orders/internal/completed?cursor=&limit=` — `@Public()` + `@UseGuards(InternalAuthGuard)` → paged COMPLETED orders **with items**, `{orders:[{id,customerId,depotId,completedAt,items:[{productId,productName,sku,unit}]}], nextCursor}`. Cursor = last order id ordered by `(createdAt,id)`; `nextCursor` null when page < limit. Add `OrderRepository.findCompletedPage(cursor, limit)`.

- [ ] **Step 1:** Write failing unit: extend the existing full-lifecycle spec — on `to===COMPLETED`, `FakeRecommendationCoordination.recordCompleted` called once with the order id + items; NOT called on other transitions.
- [ ] **Step 2:** Write failing e2e: `GET /orders/internal/completed` right-key 200 (returns a seeded completed order with items + nextCursor), wrong/no key 401.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Implement: add port/adapter/token/config/env; inject into `OrderService` (append to ctor — update the documented ctor arg order note in memory later); in `updateStatus`, after existing loyalty/referral awards when `to===COMPLETED`, `await this.recommendation.recordCompleted(order).catch(()=>{})` (belt-and-suspenders fail-open). Add `findCompletedPage` to repo (prisma: `where status COMPLETED, orderBy [createdAt asc, id asc], cursor/skip or keyset by id`, take limit+1 to compute nextCursor) + in-memory fake. Add internal controller route (route declared before `:id`). Add `RECOMMENDATION_SERVICE_URL` (`allow('').default('')`) to env.validation + order-config + local `.env` + `load()` block.
- [ ] **Step 5:** Run unit + e2e → PASS; order-service full suite green, tsc/eslint clean.
- [ ] **Step 6:** Commit `feat(order): push completed orders to recommendation-service + internal feed`.

---

### Task 7: gateway + infra + env + docs

**Files:**
- Modify: `services/gateway-service/src/**` (segment map — add `recommendations` → `RECOMMENDATION_SERVICE_URL`), gateway `env.validation.ts` + config, gateway test (routing assertion)
- Modify: `services/recommendation-service/.env.example`, repo-root `.env.example`, repo-root `.env` (local synced secrets), infra DB-init script (add `hydromart_recommendation`), `docs/DATABASE.md`

**Interfaces:**
- Public path `POST/GET /recommendations/api/v1/...` → strip `recommendations` → proxy to `RECOMMENDATION_SERVICE_URL`. (Note controller path is `recommendations`, so gateway segment `recommendations` maps a doubled prefix — confirm against sibling: gateway strips first segment then proxies remainder `/recommendations/api/v1/...`. Match how `orders` segment is configured; the controller `@Controller('recommendations')` under global prefix `api/v1` means the upstream path is `/api/v1/recommendations/...`, and gateway forwards `/api/v1/...`? **Re-read `gateway-service` resolveRoute + a working segment (orders) before editing** and mirror exactly.)

- [ ] **Step 1:** Read `services/gateway-service` routing + `orders`/`referrals` segment wiring. Add `recommendations` identically.
- [ ] **Step 2:** Add gateway routing test (recommendations segment resolves to `RECOMMENDATION_SERVICE_URL`). Run → PASS.
- [ ] **Step 3:** Add `RECOMMENDATION_SERVICE_URL` to gateway env.validation + config + `.env.example`; add the `hydromart_recommendation` DB + `RECOMMENDATION_*` block to repo-root `.env.example`, infra DB-init, and `docs/DATABASE.md` table. Sync local `.env` (root + service) with shared secrets.
- [ ] **Step 4:** Commit `feat(gateway): recommendations segment + infra/env/docs`.

---

### Task 8: Migration + apply live

**Files:**
- Create: `services/recommendation-service/prisma/migrations/<ts>_init/migration.sql`, `prisma/rollback.sql`

- [ ] **Step 1:** With Docker up (`npm run db:up`), create the DB `hydromart_recommendation` (infra init or manual `CREATE DATABASE`). Generate migration: `npx prisma migrate dev --name init --schema services/recommendation-service/prisma/schema.prisma` (or `migrate diff` → SQL then `migrate deploy` to match repo convention — check how a recent sibling migration was produced).
- [ ] **Step 2:** Write `rollback.sql` dropping the 5 tables.
- [ ] **Step 3:** Apply live: `npm run db:migrate` (idempotent `prisma migrate deploy`). Verify tables exist (`\dt` in the recommendation DB).
- [ ] **Step 4:** `npm run db:validate` — all schemas valid incl. recommendation.
- [ ] **Step 5:** Commit `feat(rec): initial migration (applied live)`.

---

### Task 9: Web rails (reorder / related / trending)

**Files:**
- Create: `apps/web/src/lib/recommendations.ts`, `apps/web/src/components/product-rec-rail.tsx`
- Modify: `apps/web/src/lib/endpoints.ts` (+`recommendations`), `apps/web/src/lib/types.ts` (+`Recommendation`), `apps/web/src/app/page.tsx` (home reorder rail), `apps/web/src/app/orders/page.tsx` (reorder rail), product detail page (`app/products/[id]/page.tsx` — related rail), catalog/browse page (trending rail)
- Test: `apps/web/test/recommendations.test.ts`

**Interfaces:**
- `endpoints.recommendations = { reorder(limit?), related(productId, limit?), trending(depotId?, days?, limit?) }` building `/recommendations/api/v1/...` paths (mirror existing `endpoints.orders` style — confirm gateway prefix shape).
- `type Recommendation = { productId: string; name: string; sku: string; unit: string; score: number }`.
- `<ProductRecRail title endpoint auth?>`: `useAsync` fetch; **render nothing when list empty or on error** (discovery, non-blocking); loading skeleton; each item → card linking `/products/[productId]` + add-to-cart via existing cart hook.

- [ ] **Step 1:** Write `test/recommendations.test.ts` (FAILING): endpoint builders produce correct paths (reorder/related/trending with + without params); any pure helper (limit clamp / empty-guard). Run vitest → FAIL.
- [ ] **Step 2:** Implement `lib/recommendations.ts` (endpoint builders + type + helper). Run vitest → PASS.
- [ ] **Step 3:** Implement `<ProductRecRail>`; place reorder rail (home + orders, signed-in via auth token; hidden when empty), related rail (product detail, public, `related(productId)`), trending rail (catalog, public). Reuse existing product-card markup + cart hook — do not duplicate cart logic.
- [ ] **Step 4:** `npx tsc --noEmit` (web), `npx eslint` (web), `npm run build -w @hydromart/web` (`next build`) all clean; rails prerender/CSR without a backend (useAsync client fetch, empty states).
- [ ] **Step 5:** Commit `feat(web): reorder/related/trending recommendation rails`.

---

### Task 10: Full-workspace green + memory update

- [ ] **Step 1:** Root `npm test` (all services + web) green; root typecheck + `next build` clean; `npm run db:validate` all schemas valid.
- [ ] **Step 2:** Optional smoke: boot auth+gateway+order+recommendation, complete an order, `GET /recommendations/api/v1/reorder` via gateway returns the just-bought product (per prod-boot-findings smoke pattern).
- [ ] **Step 3:** Update memory `hydromart-current-state.md` with M-R3.5 (test counts, ctor-arg-order note for order.service, ceilings) and `hydromart-prod-boot-findings.md` if smoke run done. Update `MEMORY.md` only if a new file is added (not needed).
- [ ] **Step 4:** Commit `feat(rec): M-R3.5 recommendation service complete` (or rely on per-task commits + a final memory commit).

---

## Self-Review

- **Spec coverage:** three engines (T2), read model incl. ProductRef/IngestedOrder (T1/T3), idempotent event ingest (T4/T6), admin rebuild + internal feed (T5/T6), query API + RBAC (T5), gateway/env (T7), migration live (T8), web three rails (T9), ML seam documented (in service query — note in T4 impl comment), ceilings (spec). Covered.
- **Placeholder scan:** base-count mechanism resolved by adding `ProductRef.buyCount` (T3 step 1). Gateway prefix shape flagged as "read sibling first" (T7) — legitimate, exact wiring is codebase-specific and must mirror a working segment rather than be guessed.
- **Type consistency:** `IngestCommand`/`IngestItem`/`RecItem`/`PurchaseRow`/`CoBuyRow`/`DailyRow` used consistently T2→T6; `RecommendationRepository` methods match between port (T3) and service (T4); `OrderFeedPort.fetchCompleted` returns `IngestCommand[]` consumed by RebuildService.
