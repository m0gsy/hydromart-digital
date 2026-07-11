# Forecast Service — Implementation Plan (M-R3.6)

Spec: `docs/superpowers/specs/2026-07-11-forecast-service-design.md`.
Template: `services/recommendation-service` (clone structure; swap ranking engines for
time-series forecasting; daily aggregate becomes quantity-aware).

Execution: subagent-driven-development — one implementer per task, reviewer after, main thread
integrates + runs gates. Each task ends green (typecheck/lint/test for the touched workspace).

## Tasks

1. **Scaffold `services/forecast-service`.** Clone recommendation-service's non-domain
   skeleton: `package.json` (name `@hydromart/forecast-service`, port 3014, scripts incl.
   `--preserve-symlinks` on start/start:prod, `postbuild` prisma-copy), `tsconfig*.json`,
   `nest-cli.json`, `.eslintrc.cjs`, `jest` config, `main.ts` (Swagger `/docs`, helmet, CORS,
   global pipes/guards from platform), `app.module.ts`, `config/env.validation.ts` +
   `config/forecast-config.service.ts` (port, databaseUrl, jwtAccessSecret, internalServiceKey
   Joi `allow('').default('')`, orderServiceUrl), `infrastructure/prisma/prisma.service.ts`,
   `modules/health.controller.ts`, `Dockerfile`, `.env.example`. `prisma/schema.prisma` with
   the 3 models (§Read model) + generator output `prisma/generated/client`. Migration
   `prisma/migrations/0001_init/migration.sql` + `rollback.sql`. Builds + boots (health 200).

2. **Domain + unit tests.** `src/domain/{series,moving-average,trend,forecast}.ts` per spec.
   `test/unit/domain.spec.ts`: gap-fill, partial-window MA, trend slope sign, flat/single-point,
   forecastDemand rising/empty/short-blend/non-negative/horizon-length.

3. **Ports + fakes.** `application/ports/forecast.repository.ts` (IngestCommand, IngestItem
   with quantity, ProductDailyDemand row shape, ProductRef, query methods:
   `hasIngested`, `applyIngest(cmd)`, `findDemandRows({productId?, depotId?, fromDay, toDay})`,
   `findProductRef(id)` / `findRefs(ids)`, `listDepotProducts(depotId, fromDay, toDay)`),
   `application/tokens.ts`, `test/support/fakes.ts` in-memory impl mirroring the transaction
   semantics.

4. **Prisma repository adapter.** `infrastructure/prisma/forecast.prisma.repository.ts` — the
   `$transaction` ingest (idempotent), windowed row queries, ref enrich. Prisma `Int`→number,
   `Date` day handling.

5. **ForecastService + tests.** `application/services/forecast.service.ts`: `ingest`, `demand`
   (global/depot, dense series → forecastDemand → enrich), `depotRollup` (per-product forecast,
   rank by predictedTotal, clamp limit). `test/unit/forecast.service.spec.ts` (quantity sum,
   idempotent, global-vs-depot, rollup ranking, empty).

6. **RebuildService + order feed.** `application/services/rebuild.service.ts`,
   `application/ports/order-feed.port.ts`, `infrastructure/http/order-feed.http.adapter.ts`
   (clone recommendation's; item shape includes quantity; fail-open empty page). Unit test
   rebuild paging + convergence via fake.

7. **Controllers + module + e2e.** `modules/dto/forecast.dto.ts` (IngestDto with items+quantity,
   query DTOs with clamps), `modules/ingest.controller.ts` (@Public+InternalAuthGuard),
   `modules/forecast.controller.ts` (demand + depot, @Roles PLANNING_ROLES),
   `modules/rebuild.controller.ts` (@Roles SUPER_ADMIN), `modules/forecast.module.ts` wiring all
   providers + tokens. `test/e2e/forecast.e2e.spec.ts` RBAC matrix (§Testing). Seed
   `process.env.INTERNAL_SERVICE_KEY` before compile (Joi default-'' gotcha).

8. **order-service wiring.** Add `quantity` to `internal/completed` feed item shape
   (controller return type + `internalCompleted` mapper + any OrderFeed types). New
   `application/ports/forecast-coordination.port.ts` + `infrastructure/http/forecast-coordination.http.adapter.ts`
   (clone recommendation-coordination; body items carry quantity; fail-open; blank-config no-op).
   Inject LAST in `OrderService` ctor (no positional shift), fire on COMPLETED after
   recommendation ingest with `.catch()`. New `FORECAST_SERVICE_URL` env (config +
   env.validation + `.env.example` + e2e load block). Update `FakeForecastCoordination` +
   order-service specs (+assertion forecast fires on COMPLETED, not before).

9. **gateway + infra + docs.** gateway: add `forecast` segment → `FORECAST_SERVICE_URL`
   (route map + config + env.validation + `.env.example`) + routing test. infra init script +
   root `.env.example` add `hydromart_forecast` DB + FORECAST env block; `docs/DATABASE.md`
   gains a forecast row.

10. **web `/dashboard/forecast`.** `lib/forecast.ts` (endpoint builders + `ForecastItem` type +
    `trendLabel`), `lib/roles.ts` `canViewForecast`, `endpoints.forecast.{demand,depot}`,
    `app/dashboard/forecast/page.tsx` (depot picker, history/horizon selectors, per-product
    table, gated), dashboard discovery link, nav none. Vitest: `trendLabel`, `canViewForecast`,
    endpoint builder. `next build` clean (route prerendered).

## Integration / gates

After task 8+ run the full workspace: `npm run typecheck && npm run lint && npm test` per
touched service, `next build` for web, `npm run db:migrate` (Docker up) to apply `0001_init`
live, smoke the forecast query against live Postgres. Final: update memory
`hydromart-current-state.md`, commit `feat(forecast): demand forecasting service (M-R3.6)` —
completes Release 3.
