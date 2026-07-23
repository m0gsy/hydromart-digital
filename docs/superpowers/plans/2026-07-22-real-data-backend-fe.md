# Real-data backend + frontend completion plan

> Execute sequentially with TDD. Preserve database-per-service ownership; cross-service reads go through HTTP/BFF contracts. Payment remains direct-to-depot by product decision.

## Scope

Replace the remaining design-fidelity stubs with authoritative data for tracking, team performance, inventory movements, operational P&L, promotion analytics, courier incentives, and ops-notification read state. Keep the existing role-aware franchise redirect and make shared dashboard widgets role-appropriate.

## Task 1 — Live tracking and depot team metrics

**Delivery service**

- Extend location updates so each valid courier ping refreshes `estimatedArrivalAt` from the configured urban-speed policy.
- Add a depot-team report over a validated date range: per-courier delivered/on-time/failed/order ids and per-operator settlement verification counts/variance.
- Extend the existing internal order-rating batch contract to return ratings by order id so courier rating is aggregated without N+1 calls.
- Add repository/service/controller/DTO tests first, then implementation and Swagger metadata.

**Web**

- Replace client haversine distance with server `estimatedArrivalAt` minutes/time.
- Add a Leaflet/OSM tracking map with courier and destination markers using the existing map dependency.
- Replace static team rows with the real depot-team report and resolve staff names through the existing staff roster.

**Primary files:** `services/delivery-service/src/**`, `services/order-service/src/**`, their tests, `apps/web/src/app/dashboard/tracking/**`, `apps/web/src/app/dashboard/team-performance/page.tsx`, `apps/web/src/lib/{endpoints,types}.ts`.

## Task 2 — Depot-wide stock ledger and operational monthly P&L

**Depot service**

- Add a paginated depot-wide stock-movement query with movement-type/date filters and joined item label/type.
- Add a monthly cost report using authoritative data: COGS from SALE quantities valued against received-PO unit costs, and opex from cashbook OUT entries excluding inventory procurement already counted as COGS.
- Keep the result explicitly operational/management P&L, not statutory accounting.
- Add repository/service/controller/DTO tests first; no schema change is expected.

**Dashboard BFF + web**

- Add a BFF monthly-P&L endpoint that combines order-service monthly revenue with depot-service monthly costs and marks source availability.
- Replace the inventory N-request merge and fixed P&L ratios with these endpoints.

**Primary files:** `services/depot-service/src/**`, `services/dashboard-service/src/**`, their tests, `apps/web/src/app/dashboard/{inventory,monthly-pnl}/**`, `apps/web/src/lib/{endpoints,types}.ts`.

## Task 3 — Promotion analytics

**Promo service**

- Add `GET /promotions/:id/analytics` using the linked `voucherCode` and voucher-redemption rows.
- Return total/weekly uses, savings, affected order ids/count, seven-day buckets, and top customer ids.
- Add an internal order-value lookup in order-service and a fail-open promo HTTP port so gross affected-order value is real without sharing databases.
- Add tests first for no voucher, no redemptions, aggregation, authorization, and source failure.

**Web**

- Delete deterministic seeded analytics and consume the endpoint with loading/error/empty states.
- Display customer ids honestly when no customer-profile batch source exists.

**Primary files:** `services/promo-service/src/**`, `services/order-service/src/**`, their tests, `apps/web/src/app/dashboard/promotions/page.tsx`, `apps/web/src/lib/{endpoints,types}.ts`.

## Task 4 — Real courier goal and tier incentives

**Payout service**

- Extend effective-dated courier earning rules with a monthly earnings target and ordered delivery-count incentive tiers.
- Add Prisma migration with rollback SQL and regenerate the service-local client.
- Expose the effective rule to the authenticated courier.
- When a completed-delivery earning crosses a configured monthly tier, post one idempotent `INCENTIVE` ledger credit for that courier/rule/month/tier.
- Add domain/service/repository/controller/DTO tests first, including duplicate event and tier-boundary cases.

**Web**

- Remove `MONTH_TARGET` and `TIERS`; fetch the effective goal config and render only configured tiers.

**Primary files:** `services/payout-service/prisma/**`, `services/payout-service/src/**`, tests, `apps/web/src/app/driver/goal/page.tsx`, `apps/web/src/lib/{endpoints,types}.ts`.

## Task 5 — Persistent ops notification state and mobile parity

**CRM service**

- Add per-staff operational-notification reads via a dedicated relation/table and migration with rollback SQL.
- Return `readAt` in the ops feed and add idempotent mark-one/mark-all endpoints.
- Preserve append-only notification audit rows and existing customer inbox behavior.
- Add service/repository/controller/DTO tests first.

**Web**

- Replace session-local read sets with server state.
- Give manager mobile the same grouping, event filters, unread filter, row read, and mark-all behavior as desktop.

**Primary files:** `services/crm-service/prisma/**`, `services/crm-service/src/**`, tests, `apps/web/src/app/dashboard/notifications/page.tsx`, `apps/web/src/app/m/manager/notifications/page.tsx`, `apps/web/src/lib/{endpoints,types}.ts`.

## Task 6 — Role-appropriate shared dashboard landing

- Keep franchise owners redirected to `/dashboard/franchise`.
- Keep manager operational KPIs/widgets.
- For executive roles, replace manager action widgets with the already-returned top-customer/top-depot lists.
- Add focused web tests for the pure role/view selection helper and ensure no duplicated API calls.

**Primary files:** `apps/web/src/app/dashboard/page.tsx`, dictionary fragments only if new copy is required, web tests.

## Task 7 — Integration and release gates

- Run Prisma validation/generation for changed services and validate forward/rollback SQL.
- Run targeted unit/e2e tests after each task, then repository `typecheck`, `lint`, `test`, `build`, and database validation.
- Search targeted FE files for remaining `TODO(backend)`, deterministic rows, and fixed business ratios/targets.
- Review authz, depot scoping, pagination, date-window boundaries, money integer handling, source failure behavior, and N+1 risks.
- Update architecture/API docs and memory only where project policy requires tracked repo documentation.
- Commit, push, and create a stacked PR from `codex/real-data-backend-fe` to `feat/design-fidelity-batch-AB`.

