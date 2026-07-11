# Dynamic Pricing (R3) — Design

**Date:** 2026-07-11
**Slice:** Release 3 — Dynamic Pricing (time/condition-based)
**Home service:** depot-service (extends existing per-depot pricing)

## Goal

Let depot managers define time/condition-based price adjustments (happy-hour
discount, weekend surcharge, promo window) per depot. Rules layer on top of the
existing per-depot `sellPrice` override and catalog base price, resolved at
checkout so the order total reflects the active rule server-side.

Non-goal (deferred): demand/stock-driven auto-pricing (overlaps the Predictive
Analytics slice), category-level targeting, customer-facing "special price"
display.

## Why depot-service (not a new service)

depot-service already owns `Depot`, per-depot `InventoryItem.sellPrice`, and the
`GET /depots/:depotId/inventory/prices` endpoint that order-service already
calls at checkout. Rules live where pricing already lives. No new service, DB,
gateway segment, or order-service port — the existing price response carries the
active adjustment.

Constraint that drove this: a PERCENT rule needs the base price to compute
against, and only order-service knows the catalog base (`override ?? basePrice`,
`order.service.ts:119`). So depot-service **stores + serves** the winning rule;
order-service **applies** it to its resolved base.

## 1. Data model (depot-service, DB `hydromart_depot`)

New `PricingRule` table — migration `0007_pricing_rules` (additive, nullable
fields, applied live via `prisma migrate deploy`).

```
PricingRule
  id          uuid pk
  depotId     uuid    required, @@index   (rules are per-depot)
  productId   uuid?   null = depot-wide (applies to every line)
  adjustType  PricingAdjustType  PERCENT | FIXED
  value       Decimal(12,2) signed
                PERCENT: -10 = 10% off,  +5 = 5% surge
                FIXED:   -2000 = Rp2000 off, +1000 = Rp1000 surcharge
  daysOfWeek  Int[]   0=Sun..6=Sat, empty = every day
  startMinute Int?    minutes since midnight (local TZ), null = all day
  endMinute   Int?    exclusive upper bound; null = all day
  validFrom   DateTime?  null = open-ended
  validUntil  DateTime?  null = open-ended
  priority    Int     higher wins ties, default 0
  active      Boolean default true
  createdAt / updatedAt
```

New Prisma enum `PricingAdjustType { PERCENT, FIXED }`.

**Deferred:** category-level targeting — depot-service has no product→category
map (that's product-service). Depot-wide + product-specific cover MVP.
Upgrade path: a `categoryId` column + a CategoryPort resolving product category.

## 2. Rule resolution (depot-service owns "now")

Pure domain fn `resolveRule(rules, productId, now)`:

1. filter `active` rules for this depot that are **in window** at `now`:
   - `productId` matches the line's product **or** rule is depot-wide (`productId=null`)
   - `now` weekday ∈ `daysOfWeek` (or `daysOfWeek` empty)
   - `startMinute <= nowMinute < endMinute` (or both null)
   - `validFrom <= now <= validUntil` (nulls = open)
2. pick **exactly one** winner (no stacking, mirrors BR-015 one-voucher):
   product-specific beats depot-wide → higher `priority` → newest `createdAt`.
3. no match → no adjustment.

`now` evaluated in a single configured timezone `PRICING_TZ`
(default `Asia/Jakarta` / WIB). **Ceiling:** Indonesia spans WIB/WITA/WIT;
multi-TZ needs a per-depot `timezone` column later.

Domain lives in `depot-service/src/domain/pricing-rule.ts`:
`resolveRule`, `isRuleActive(rule, now, tz)`, `PricingAdjustType`. Pure, tested.

## 3. Wiring — existing endpoint, no new port/gateway

`GET /depots/:depotId/inventory/prices?productIds=` response extends per product:

```jsonc
{ "productId": "...", "sellPrice": 18000, "adjustType": "PERCENT", "value": -10 }
```

`sellPrice` = existing static override (unchanged; omitted when none).
`adjustType`/`value` = the winning active rule (omitted when none).
`InventoryService.pricesForProducts` now also resolves rules for each requested
productId and merges. A product with **no** stocked line but a **depot-wide
rule** still returns a row (adjustment only, no sellPrice).

order-service (`order.service.ts` checkout loop):

```
base      = override ?? product.basePrice     // override = depot sellPrice
unitPrice = applyAdjustment(adj, base)         // pure, in order domain
```

New pure fn `applyAdjustment(adj, base)` in
`order-service/src/domain/pricing.ts`:
- PERCENT: `base * (1 + value/100)`
- FIXED:   `base + value`
- clamp to `>= 0`, `money(2dp)` round.
Tested (percent off, fixed off flooring at 0, surge, no-adj passthrough).

`DepotPricingPort.getPrices` return type changes from `Map<string, number>`
(sellPrice) to `Map<string, { sellPrice?: number; adjustType?; value? }>` — the
adapter parses the extended body; the in-memory `FakeDepotPricing` mirrors.
order-service reads `override = row.sellPrice`, `adj = { row.adjustType, row.value }`.

**Fail-open unchanged:** depot down / non-2xx / timeout ⇒ empty map ⇒ base price,
no adjustment. Never blocks checkout.

## 4. Admin CRUD (depot-service)

New controller routes, `@Roles(DEPOT_MANAGER, SUPER_ADMIN)` (mirror
`DEPOT_ADMIN_ROLES`):

- `POST   /depots/:depotId/pricing/rules`     create
- `GET    /depots/:depotId/pricing/rules`     list (all, incl. inactive)
- `PATCH  /depots/:depotId/pricing/rules/:id` update
- `DELETE /depots/:depotId/pricing/rules/:id` delete (hard — rules are cheap)

DTO validation: `adjustType @IsEnum`, `value @IsNumber`, `daysOfWeek` each
`@IsInt @Min(0) @Max(6)`, `startMinute`/`endMinute` `@Min(0) @Max(1440)`,
`priority @IsInt`, `validFrom`/`validUntil` `@IsDateString`. Cross-check
`endMinute > startMinute` and `validUntil >= validFrom` when both present.

Route ordering: `pricing/rules` static segment declared before any `:itemId`
dynamic inventory routes (same discipline as `inventory/low-stock`,
`inventory/prices`).

## 5. Web staff console (`apps/web`)

New `/dashboard/pricing` route (reuses customer-app auth/api/session — NO
`apps/admin`): depot picker (existing `endpoints.depots.browse`) → list rules for
the depot → create/edit form (product optional = depot-wide, adjust type +
value, day checkboxes, start/end time, date range, priority, active) → delete.

Gated client-side by new `lib/roles.ts` `canManagePricing`
(DEPOT_MANAGER/SUPER_ADMIN) mirroring depot-service roles; server stays
authority. Pure `lib/pricing.ts` `toRulePayload` (coerces string form → numeric
payload, pre-validates ranges + end>start + date order) — tested.
New `endpoints.pricing.{rules,create,update,detail}` builders + `PricingRule`/
`PricingRulePayload` types. Dashboard discovery link for pricing managers; nav
unchanged (reachable from `/dashboard`).

**Customer-facing display deferred:** catalog is product-service with no depot
context pre-address; checkout total already reflects the rule server-side.
Upgrade path: an adjusted-price preview once the depot is known (post-address).

## Testing

- depot-service: `resolveRule`/`isRuleActive` unit (window match: day, time,
  date range, precedence product>depot-wide>priority>newest, exactly-one,
  no-match); `pricesForProducts` merges rule + sellPrice; e2e RBAC on CRUD
  (manager 200 / customer 403) + prices endpoint returns adjustment.
- order-service: `applyAdjustment` unit (percent/fixed/clamp/passthrough);
  checkout applies the rule to base, fail-open when depot omits adjustment.
- web: `toRulePayload` + `canManagePricing` vitest cases.

## Milestone summary

`M-R3.4 — Dynamic Pricing`. depot-service PricingRule + resolution + CRUD +
extended prices endpoint; order-service applyAdjustment at checkout; web
`/dashboard/pricing` console. Backend + staff surface in one slice, matching the
codebase pattern.

## Ceilings (documented)

- Single TZ (`PRICING_TZ`, Asia/Jakarta) — multi-TZ later via `depot.timezone`.
- No category targeting — depot-wide + product-specific only.
- No customer-facing special-price display pre-checkout.
- Exactly-one-rule, no compounding (deliberate).
