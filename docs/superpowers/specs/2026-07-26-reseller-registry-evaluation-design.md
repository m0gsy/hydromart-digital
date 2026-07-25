# Reseller Registry + Per-Depot Achievement Evaluation — Design

Date: 2026-07-26
Status: Approved (brainstorming) — pending implementation plan

## Problem

Mama's improvement idea #2: a database of **resellers/agents** ("agen") that can be
evaluated for their achievement per depot. Resellers buy water in bulk from a depot and
resell to end customers. Ops currently has no way to register them or track whether they
hit their monthly volume.

## Definition (locked in brainstorming)

- **Agen = reseller** who buys bulk from a depot and resells. Has a monthly volume target,
  evaluated per depot.
- Resellers **order through the app** like normal customers, so they already exist as
  `CustomerProfile` + auth subject. A reseller is therefore a *facet* of an existing
  customer, not a brand-new identity.
- Volume is **auto-derived from `order-service`** (orders they place). No manual entry.

## Scope

**In (MVP):**
- Reseller registry per depot (register/edit/deactivate).
- Monthly volume target per reseller.
- Achievement dashboard: volume, target attainment %, growth vs last month, activity/recency.

**Out (deferred / YAGNI):**
- Reseller-specific pricing (wholesale/discount) — separate pricing engine, phase 2.
- A dedicated `agent-service` — not warranted for a registry + read-time rollup.
- Stored "actuals" snapshot table — derive at read time first; add a cache only if slow.
- Cross-depot resellers — one home depot per reseller for MVP (revisit if needed).

## Architecture

Reuse two existing services; add web console pages. Mirrors the existing `DepotTarget`
pattern: **goals are stored, actuals are derived at read time from order reports.**

### 1. Registry + target — `customer-service`

New model `ResellerProfile` (identity extension of an existing customer):

```prisma
model ResellerProfile {
  customerId       String   @id @db.Uuid   // = existing CustomerProfile.customerId
  homeDepotId      String   @db.Uuid       // the depot they buy from → "per depot" scope
  monthlyTargetQty Int      @default(0)     // target galon/month (units, not IDR)
  active           Boolean  @default(true)
  joinDate         DateTime @db.Date
  note             String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([homeDepotId])
  @@map("reseller_profiles")
}
```

Endpoints (hexagonal, same shape as existing customer-service modules):
- `POST   /v1/resellers`                register a reseller (customerId, homeDepotId, target, note)
- `GET    /v1/resellers?depotId=&active=` list, depot-scoped for managers
- `GET    /v1/resellers/:customerId`     one reseller
- `PATCH  /v1/resellers/:customerId`     edit target / depot / note / active
- Validation: `customerId` must be an existing `CustomerProfile`; `monthlyTargetQty >= 0`.

### 2. Evaluation rollup — `order-service`

One new `ReportService` method + endpoint, alongside the existing `/v1/reports/*` routes:

- `GET /v1/reports/reseller-rollup?depotId=&month=YYYY-MM`

Given the set of reseller `customerId`s for that depot (passed in, or the console filters),
aggregate delivered orders and return per reseller:
- `volumeQty`   = Σ `OrderItem.quantity` over the reseller's delivered orders in `month`
- `prevVolumeQty` = same for the previous month (drives growth)
- `orderCount`  = number of delivered orders in `month`
- `lastOrderAt` = most recent order timestamp

The reseller→customer mapping lives in customer-service; the rollup takes a list of
customerIds (batch, internal-service auth like the existing `internal/completed` /
batch-totals endpoints) so order-service stays ignorant of "reseller" as a concept.

### 3. Merge + display — web console

Pages:
- `/hq/resellers` — HEAD_OFFICE / SUPER_ADMIN, all depots (depot filter).
- Depot-manager view — own depot only (`DEPOT_MANAGER`), same component depot-scoped.

The page reads the registry (targets) from customer-service and the rollup (actuals) from
order-service, then computes per reseller:
- `attainmentPct = volumeQty / monthlyTargetQty` (guard divide-by-zero → target 0 = "no target")
- status badge: **di bawah** (`< 100%`) / **tercapai** (`>= 100%`) / **lampaui** (`>= 120%`)
- growth arrow: `volumeQty` vs `prevVolumeQty` (↑ / ↓ / flat, with %)
- activity: `orderCount` this month + `lastOrderAt` (flag pasif if no order in N days)

RBAC via the existing report roles (`HEAD_OFFICE`, `DEPOT_MANAGER`, `SUPER_ADMIN`) and the
`@hydromart/access` capability map — no new role.

## Data flow

```
Register reseller  → customer-service ResellerProfile (customerId, homeDepotId, target)
Reseller places order (app) → order-service Order/OrderItem (existing, unchanged)
Open /hq/resellers  → web reads registry (targets) + reseller-rollup (actuals)
                    → computes attainment% / growth / activity per reseller (read time)
```

## Evaluation math (pure, testable)

A small pure helper (web + optionally server) computes the display metrics from
`{ volumeQty, prevVolumeQty, monthlyTargetQty, lastOrderAt }`:
- `attainmentPct`: `target <= 0 ? null : round(volume / target * 100)`
- `status`: `attainmentPct == null ? 'no-target' : >=120 'lampaui' : >=100 'tercapai' : 'di-bawah'`
- `growthPct`: `prev <= 0 ? (volume > 0 ? +100 : 0) : round((volume - prev) / prev * 100)`
- `pasif`: `lastOrderAt == null || daysSince(lastOrderAt) > INACTIVE_DAYS`

This is the one non-trivial branch/loop in the feature → it gets a unit test.

## Error / edge handling

- Register a `customerId` that isn't a customer → 400.
- Register the same customerId twice → 409 (PK conflict); edit instead.
- Deactivate (soft, `active=false`) rather than delete, to keep history.
- Reseller with `monthlyTargetQty = 0` → shown as "no target", never divides.
- Reseller with zero orders in the month → volume 0, attainment 0% / no-target, pasif flag.
- Orders counted only in a settled/delivered state (reuse the report's existing status filter).

## Testing

- `order-service` unit: reseller-rollup aggregation (volume, prev month, order count, last order)
  over a fixture set — jest, `test/unit/*.spec.ts`.
- Web unit: the evaluation-math helper (attainment/status/growth/pasif) — vitest,
  `test/*.test.ts`, matching the existing `hr.test.ts` shape.
- Registry CRUD covered by the service unit + HTTP adapter test (existing pattern).

## Effort estimate

1 Prisma migration + registry CRUD (customer-service), 1 report method + 1 endpoint
(order-service), 2 web console surfaces. Medium — roughly two Rule-E-sized slices.
