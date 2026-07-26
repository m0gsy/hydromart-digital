# Reseller Special Pricing — Design

**Date:** 2026-07-26
**Status:** Approved (brainstorming), ready for implementation plan
**Depends on:** [reseller registry feature](2026-07-26-reseller-registry-evaluation-design.md) (`ResellerProfile`, `/resellers` console)

## Problem

Resellers (agen) buy for resale and are negotiated a discount off the normal
retail price. Today the platform has no reseller-specific price: a reseller
customer pays the same resolved price as any customer, plus whatever membership
tier discount and vouchers apply. Mama needs each reseller to get their own
agreed discount, and NOT to also stack retail promotions on top.

## Decisions (from brainstorming)

1. **Discount shape:** flat percent off the subtotal, per reseller (e.g. Agus 10%,
   Bima 15%). Not per-product, not quantity tiers.
2. **Stacking:** **reseller-only.** When an active reseller checks out, they get
   their reseller discount and nothing else — no membership tier discount, no
   voucher.
3. **Where set:** per reseller. A `discountPct` field on `ResellerProfile`, edited
   in the `/resellers` staff console (HQ / depot manager).
4. **Voucher conflict:** **reject with a clear message.** A reseller submitting a
   voucher gets a 400; the checkout UI hides the voucher entry for resellers.

## Scope

- The discount applies to **all** of the reseller customer's interactive checkouts —
  any depot, any product — as long as `ResellerProfile.active = true` and
  `discountPct > 0`. Flat percent of the subtotal only (not delivery fee).
- `active = false` (or `discountPct = 0`) → discount disappears; normal
  membership + voucher rules resume automatically.
- **Out of scope (v1):** scheduled/subscription orders (`placeScheduled`) do NOT
  get the reseller discount. That path is non-interactive, carries no voucher, and
  can be revisited if resellers actually use subscriptions. (YAGNI.)
- No change to how a reseller is registered or evaluated — only pricing is added.

## Architecture

Chosen approach: **mirror the existing membership-discount pattern.** Checkout
already resolves a per-customer, post-subtotal discount (membership rate) and a
voucher, then caps the combined discount at the bill. The reseller discount slots
in as a branch **before** that block. Rejected alternatives: folding reseller into
a merged "customer discount rate" (overloads the membership adapter and hides the
voucher-reject rule); per-line pricing by threading `customerId` into depot pricing
(wrong layer, overkill for a flat percent).

### 1. Data — customer-service

- Add `discountPct Int @default(0)` to the `ResellerProfile` model (0–100).
  New Prisma migration (dev-only for now, same as the other pending migrations —
  see the deploy caveat).
- `RegisterResellerDto` and `UpdateResellerDto` gain `discountPct?: number`
  (integer, `@Min(0) @Max(100)`, default 0 on register).
- `ResellerService.register` / `update` pass the field straight through to the repo.

### 2. Self endpoint — customer-service

New endpoint for the checking-out customer to resolve their own reseller pricing:

```
GET /api/v1/resellers/me
```

- Auth: ordinary authenticated customer (reads `customerId` from the token — NOT
  the staff-gated `@Roles` on the rest of the reseller controller).
- Response: `{ active: boolean, discountPct: number }` when the caller is a
  registered reseller; **404** when they are not.
- Implemented on the existing `ResellerService` (`findById(customerId)`), exposed
  via a separate route/guard from the staff CRUD.

### 3. Checkout — order-service

In `OrderService.checkout` (`order.service.ts`, before the membership block ~line 172):

- New outbound port `ResellerDiscountPort.get(customerId, authorization)` with an
  HTTP adapter calling `GET /resellers/me`. **Fails open:** any error, timeout, or
  404 → treated as "not a reseller" (never blocks checkout), matching the
  membership adapter's fail-open philosophy.
- Branch:
  - **Active reseller with `discountPct > 0`:**
    - If `input.voucherCode` is present → throw `ResellerVoucherNotAllowedError`
      (mapped to **400** at the controller).
    - `discount = money(min(subtotal, subtotal * discountPct / 100))`.
    - Membership discount and voucher are **skipped entirely** (no membership call,
      no promo quote/redeem).
  - **Otherwise:** the existing membership + voucher path runs unchanged.
- The order's `discount` column stays a single amount (no per-type breakdown /
  schema change). `total = subtotal + deliveryFee − discount`.
- The pure percent calc lives in `domain/pricing.ts` (or a tiny helper next to
  `applyAdjustment`) so it is unit-testable without the service.

Note: the duplicated pricing block in `placeScheduled` is intentionally left alone
(out of scope above).

### 4. Web

- **`/resellers` console:** add a "Diskon (%)" number input to both the register
  form and the inline edit row; show the current percent on each reseller row
  (e.g. "Diskon 10%"). Validate 0–100 client-side (server is authoritative).
- **Checkout page:** call `GET /resellers/me`. If the customer is an active
  reseller, hide the voucher entry and show a reseller-discount badge
  ("Harga reseller −10%"). The server still enforces the reject if a voucher is
  somehow submitted.

## Error handling

| Case | Behavior |
| --- | --- |
| customer-service unreachable / `/resellers/me` errors | Fail open — treat as non-reseller, normal pricing. |
| Reseller submits a voucher | `ResellerVoucherNotAllowedError` → 400, clear message. |
| `discountPct = 0` or `active = false` | No reseller discount; membership + voucher apply. |
| `discountPct` out of 0–100 on write | 400 from DTO validation. |

## Testing

- **order-service (unit):** reseller-active → reseller discount applied, membership
  + voucher skipped; reseller + voucher → rejects; non-reseller → unchanged path;
  fail-open when the port throws; `min(subtotal, …)` cap. Fake `ResellerDiscountPort`.
- **order-service (domain):** pure percent helper (rounding, 0%, 100%).
- **customer-service (unit):** `/resellers/me` returns `{active, discountPct}` for a
  reseller, 404 for a non-reseller; register/update persist `discountPct` with
  validation bounds.
- **web:** `/resellers` form/row renders + submits `discountPct`; checkout hides
  voucher + shows badge for a reseller. Follow existing vitest patterns.

## Rollout

- New migration `reseller_profiles.discountPct` — apply to dev; **prod apply is
  deferred** with the other pending migrations (needs VPS access + care on live data).
- No breaking change to existing reseller rows (`discountPct` defaults to 0 →
  behaves exactly as today until a percent is set).
