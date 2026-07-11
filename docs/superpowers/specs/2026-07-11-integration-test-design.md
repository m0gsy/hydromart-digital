# Cross-Service Integration Test (First Cut) — Design

**Date:** 2026-07-11
**Status:** Approved (design)
**Milestone:** Hardening — automated integration test (closes the "never validated as a running stack" gap)

## Problem

Every service is green on unit + e2e tests, but those use in-memory fakes at the port
boundary and run in a single ts-jest program. Three production-boot bugs (JWT secret
drift, Prisma-client-missing-in-`dist`, platform `JwtAuthGuard` DI) all passed every test
and only surfaced on a real boot. No automated test proves the 15-service stack boots as
built and serves a request across service boundaries. This closes that gap with one
containerized happy-path test.

## Goal

A single command that:
1. Boots the **whole prod artifact** — all 15 services from their real Dockerfiles +
   Postgres + Redis — and fails if any service does not come up healthy. (This step alone
   would have caught all 3 past boot bugs.)
2. Drives the **core transaction loop** through the gateway over real HTTP against a real
   Postgres, and asserts cross-service effects.

Non-goal (first cut): exhaustive path coverage. One happy path; ceilings listed below.

## Architecture

Three new artifacts, reusing existing infra.

### 1. `docker-compose.test.yml` (override, merged onto base `docker-compose.yml`)

Base `docker-compose.yml` already defines `postgres` (mounts
`infra/postgres/init-databases.sql`, which creates all 13 per-service DBs) and `redis`.
The override adds the 15 service containers, each `build`-ing from its existing
`services/<svc>/Dockerfile`, attached to the base network so they resolve `postgres` and
`redis` by hostname.

Per-service environment:
- `<SVC>_DATABASE_URL = postgresql://hydromart:hydromart@postgres:5432/hydromart_<svc>`
  (each service uses its own `<SVC>_DATABASE_URL`, not `DATABASE_URL`).
- **Shared, single-sourced** `JWT_ACCESS_SECRET` and `INTERNAL_SERVICE_KEY` — identical
  across every service (this is exactly the value that drifted and broke cross-service
  auth before; the test pins it once).
- Cross-service URLs `*_SERVICE_URL = http://<svc>:<port>` (container hostnames), including
  the gateway's segment→service map and every service→service coordination URL
  (order→payment/loyalty/referral/recommendation/forecast/depot/promo/crm, payment→order,
  delivery→order, depot→crm, auth→crm, crm→customer, etc.).
- `PAYMENT_WEBHOOK_SECRET`, `WHATSAPP_API_URL=""` (dev console fallback), and other
  optional envs left blank so fail-open/degraded paths stay disabled.

Only the gateway's `8080` is published to the host. All app services carry a
`healthcheck` on their `GET /health` (dashboard/gateway have no DB probe; the rest do).

Docker `CMD` stays `node dist/src/main.js` (Linux, case-sensitive, no drive letters — the
`--preserve-symlinks` Windows-dev workaround is not needed in the container).

### 2. `test/integration/run.mjs` — orchestrator

Node script (cross-platform: Windows dev today, Linux CI later). Shells out to
`docker compose` via `child_process`:

1. `compose up -d postgres redis`; poll until both healthy.
2. Host `npm run db:migrate` — applies all 13 schemas to the compose Postgres through the
   existing script (`prisma migrate deploy` per workspace; host `<SVC>_DATABASE_URL` point
   at `localhost:5432`, same container). Runs on the host because dev already has Prisma +
   generated clients; keeps the override free of a migrate service. (Ceiling: a self-
   contained migrate container is a later refinement.)
3. `compose -f docker-compose.yml -f docker-compose.test.yml up -d --build`; poll every
   service `/health` until all pass or a timeout — **this is the boot-proof step.**
4. Run `flow.mjs`; capture its exit code.
5. Teardown: `compose down` (with `-v` to drop volumes), unless `--keep` is passed for
   debugging. Always runs, even on flow failure.

Exit non-zero if any step fails. Bounded waits with clear timeout messages naming the
service that never became healthy.

### 3. `test/integration/flow.mjs` — the assertions

Plain Node + `node:assert`, all HTTP to the gateway at `http://localhost:8080` via native
`fetch`. Steps:

1. **Self-sign a `SUPER_ADMIN` JWT** with the shared `JWT_ACCESS_SECRET` (claims match what
   auth mints: `sub`, `roles`, `phone`, standard exp). There is no staff self-registration,
   so a validly-signed staff token is the legitimate staff actor and also proves every
   service accepts the shared secret.
2. **Staff** creates a product (`POST /products/api/v1/products`) → capture `id`, `basePrice`.
3. **Customer registers** with a fresh phone (`POST /auth/api/v1/auth/register`) →
   **scrape the OTP from the `auth-service` container logs** (`docker compose logs
   --no-log-prefix auth-service`, match `[DEV OTP] REGISTRATION code for <phone>: NNNNNN`,
   short retry) → `POST /auth/api/v1/auth/otp/verify` → `accessToken`. Proves the real auth
   path end to end.
4. **Customer** adds the product to cart (`POST /orders/api/v1/cart/items`), checks out
   (`POST /orders/api/v1/orders/checkout` with an address, no coords) → `orderId`, `total`.
   No coords ⇒ routing fails open to the flat delivery fee (depot/reservation not exercised).
5. **Customer** initiates a **CASH** payment (`POST /payments/api/v1/payments`
   `{orderId, method:'CASH', amount: total}`) → `paymentId`.
6. **Staff** confirms the payment (`POST /payments/api/v1/payments/:id/confirm`) — fires
   payment→order internal-confirm, advancing `CREATED→CONFIRMED`.
7. **Staff** advances the order through BR-012 to `COMPLETED` by stepping
   `PATCH /orders/api/v1/orders/:id/status` (order-service enforces the forward sequence and
   accepts a `SUPER_ADMIN` for every step, so delivery-service is not needed for the walk).
8. **Assert:** order status is `COMPLETED`, and `GET /loyalty/api/v1/loyalty/me` (customer
   token) reports `pointsBalance > 0` — proving the order→loyalty award crossed a real
   service boundary.

## Error handling

- Orchestrator: every `compose`/`fetch`/health wait is bounded; a timeout prints the
  offending service and its recent logs, then tears down and exits non-zero.
- Flow: each step asserts the HTTP status it expects; first failure throws with the step
  name, response status, and body. Teardown still runs (orchestrator's `finally`).
- OTP scrape: retry a few times over a short window (log is written synchronously when the
  console OTP adapter "sends"); give up with a clear message naming the phone if not found.

## Testing / self-check

The artifact *is* the test. Its own runnable check is the assertion block in `flow.mjs`
(order `COMPLETED` + loyalty points > 0) — if the wiring breaks, the flow exits non-zero.
No unit tests for the harness itself (it is glue; YAGNI).

## Ceilings (deferred, documented)

- Depot routing / stock reservation / per-depot pricing / inventory deduction — checkout
  runs fail-open (no coords). A second test with a seeded depot + coords covers them.
- Online payment + HMAC webhook path — CASH keeps the first flow deterministic.
- Failure paths (out-of-stock, voucher rejection, out-of-service-area) — happy path first.
- CI integration job (GitHub Actions supports Docker) — local-runnable first.
- Self-contained migrate container — migrations run from the host for now.

## Files

- `docker-compose.test.yml` (new)
- `test/integration/run.mjs` (new)
- `test/integration/flow.mjs` (new)
- root `package.json`: add `"test:integration": "node test/integration/run.mjs"`
- No production code changes.
