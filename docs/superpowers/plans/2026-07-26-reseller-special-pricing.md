# Reseller Special Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each reseller a flat per-reseller percent discount that replaces membership + voucher benefits at checkout.

**Architecture:** Add a `discountPct` field to `ResellerProfile` (customer-service) and a customer-facing `GET /resellers/me` endpoint. At checkout (order-service), a new fail-open port resolves the caller's reseller discount; when active it applies the flat percent, skips the membership + voucher path, and rejects any voucher. Web console edits the percent; web checkout hides the voucher UI for resellers.

**Tech Stack:** NestJS (hexagonal: ports + HTTP adapters), Prisma/PostgreSQL, Next.js + vitest, Jest.

## Global Constraints

- Discount is a flat percent of **subtotal only** (never delivery fee).
- Reseller pricing is **reseller-only**: no membership tier discount, no voucher, when active.
- Reseller-discount lookup **fails open**: any error / timeout / 404 → treat as non-reseller, never block checkout.
- Voucher submitted by an active reseller → reject with a domain error (business-rule 4xx).
- Only `active === true` **and** `discountPct > 0` triggers reseller pricing.
- `discountPct` is an integer, 0–100, default 0 (existing rows behave exactly as today).
- Scheduled/subscription orders (`placeScheduled`) are **out of scope** — do not touch that path.
- Tokens are `Symbol(...)`, injected via `@Inject(TOKENS.X)`. Domain errors extend `DomainError` (auto-mapped to HTTP by the global filter).

---

### Task 1: customer-service — `discountPct` field, DTO, repo, service passthrough

**Files:**
- Modify: `services/customer-service/prisma/schema.prisma:128-141` (ResellerProfile model)
- Modify: `services/customer-service/src/application/ports/reseller.repository.ts` (Reseller / CreateResellerData / UpdateResellerData)
- Modify: `services/customer-service/src/infrastructure/prisma/reseller.prisma.repository.ts` (create)
- Modify: `services/customer-service/src/modules/dto/reseller.dto.ts` (Register + Update DTOs)
- Modify: `services/customer-service/src/modules/reseller.controller.ts` (register passthrough)
- Test: `services/customer-service/test/unit/reseller.service.spec.ts` (extend) and `reseller.repository.spec.ts` (extend)

**Interfaces:**
- Produces: `Reseller.discountPct: number`; `CreateResellerData.discountPct?: number`; `UpdateResellerData.discountPct?: number`; DTOs accept `discountPct?: number` (0–100).

- [ ] **Step 1: Add the column to the Prisma schema**

In `services/customer-service/prisma/schema.prisma`, add one line to the `ResellerProfile` model (after `monthlyTargetQty`):

```prisma
model ResellerProfile {
  customerId       String   @id @db.Uuid // = existing CustomerProfile.customerId
  homeDepotId      String   @db.Uuid
  /// Monthly target in gallons (units, not IDR). 0 = no target set.
  monthlyTargetQty Int      @default(0)
  /// Flat reseller discount percent off subtotal at checkout (0-100). 0 = no reseller price.
  discountPct      Int      @default(0)
  active           Boolean  @default(true)
  joinDate         DateTime @db.Date
  note             String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([homeDepotId])
  @@map("reseller_profiles")
}
```

- [ ] **Step 2: Generate the migration + client**

Run (needs the dev Postgres up — see the live-db memory if it is not):
```bash
cd services/customer-service && npx prisma migrate dev --name reseller_discount_pct
```
Expected: a new dir `prisma/migrations/<ts>_reseller_discount_pct/migration.sql` containing:
```sql
ALTER TABLE "reseller_profiles" ADD COLUMN "discountPct" INTEGER NOT NULL DEFAULT 0;
```
If the dev DB is unavailable, create that folder + `migration.sql` by hand with the ALTER above, then run `npx prisma generate`.

- [ ] **Step 3: Extend the port interfaces**

In `services/customer-service/src/application/ports/reseller.repository.ts`, add `discountPct` to three interfaces:
```ts
export interface Reseller {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  discountPct: number;
  active: boolean;
  joinDate: Date;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface CreateResellerData {
  customerId: string;
  homeDepotId: string;
  monthlyTargetQty: number;
  discountPct?: number;
  joinDate: Date;
  note?: string | null;
}
export interface UpdateResellerData {
  homeDepotId?: string;
  monthlyTargetQty?: number;
  discountPct?: number;
  active?: boolean;
  note?: string | null;
}
```

- [ ] **Step 4: Persist `discountPct` on create**

In `services/customer-service/src/infrastructure/prisma/reseller.prisma.repository.ts`, add to the `create` data object (after `monthlyTargetQty: data.monthlyTargetQty,`):
```ts
        discountPct: data.discountPct ?? 0,
```
`update` already does `data: patch` — the new optional field flows through automatically, no change needed.

- [ ] **Step 5: Accept `discountPct` in the DTOs**

In `services/customer-service/src/modules/dto/reseller.dto.ts`, add `Max` to the imports and a field to each of `RegisterResellerDto` and `UpdateResellerDto`:
```ts
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min, MaxLength } from 'class-validator';
```
Add to `RegisterResellerDto` (after `monthlyTargetQty`):
```ts
  @ApiPropertyOptional({ minimum: 0, maximum: 100, description: 'Flat reseller discount percent off subtotal.' })
  @IsOptional() @IsInt() @Min(0) @Max(100) discountPct?: number;
```
Add to `UpdateResellerDto` (after `monthlyTargetQty`):
```ts
  @ApiPropertyOptional({ minimum: 0, maximum: 100 })
  @IsOptional() @IsInt() @Min(0) @Max(100) discountPct?: number;
```

- [ ] **Step 6: Pass `discountPct` through the controller register call**

In `services/customer-service/src/modules/reseller.controller.ts`, in `register(...)`, add `discountPct` to the object passed to `this.resellers.register`:
```ts
      return await this.resellers.register(user, {
        customerId: dto.customerId,
        homeDepotId: dto.homeDepotId,
        monthlyTargetQty: dto.monthlyTargetQty,
        discountPct: dto.discountPct,
        joinDate: new Date(dto.joinDate),
        note: dto.note,
      });
```
The `update` path passes `dto` straight to `this.resellers.update(user, customerId, dto)` — `discountPct` is already carried. `ResellerService.register` spreads `{ ...data, homeDepotId }`, so it forwards `discountPct` without change.

- [ ] **Step 7: Write failing tests for persistence**

In `services/customer-service/test/unit/reseller.service.spec.ts`, add a test that registering with `discountPct` persists it and defaults to 0 when omitted. Mirror the existing register test's fixture shape; assert on the created reseller:
```ts
  it('persists discountPct on register and defaults it to 0', async () => {
    const withPct = await service.register(hqUser, {
      customerId: CUSTOMER_ID,
      homeDepotId: DEPOT_ID,
      monthlyTargetQty: 100,
      discountPct: 15,
      joinDate: new Date('2026-01-01'),
    });
    expect(withPct.discountPct).toBe(15);

    const noPct = await service.register(hqUser, {
      customerId: OTHER_CUSTOMER_ID,
      homeDepotId: DEPOT_ID,
      monthlyTargetQty: 0,
      joinDate: new Date('2026-01-01'),
    });
    expect(noPct.discountPct).toBe(0);
  });
```
(Use whatever the existing spec names its user/id constants + in-memory or mock repo. If the mock repo is a hand fake, ensure its `create` respects `discountPct ?? 0` and stores it.)

- [ ] **Step 8: Run tests to verify they fail, then pass**

Run: `cd services/customer-service && npx jest reseller.service`
Expected: FAIL first (discountPct undefined / property missing), PASS after Steps 3-6 are in.

- [ ] **Step 9: Typecheck + commit**

Run: `cd services/customer-service && npx tsc --noEmit`
Expected: No errors.
```bash
git add services/customer-service/prisma services/customer-service/src services/customer-service/test
git commit -m "feat(reseller): add per-reseller discountPct field"
```

---

### Task 2: customer-service — `GET /resellers/me` self endpoint

**Files:**
- Create: `services/customer-service/src/modules/reseller-self.controller.ts`
- Modify: `services/customer-service/src/application/services/reseller.service.ts` (add `findMy`)
- Modify: `services/customer-service/src/modules/customer.module.ts` (register controller — BEFORE `ResellerController`)
- Test: `services/customer-service/test/unit/reseller.controller.spec.ts` (extend, or a new `reseller-self.controller.spec.ts`)

**Interfaces:**
- Consumes: `ResellerService.findById` (existing), `Reseller.discountPct` (Task 1).
- Produces: `GET /api/v1/resellers/me` → `{ active: boolean; discountPct: number }` for a registered reseller, `404` otherwise. `ResellerService.findMy(customerId): Promise<Reseller | null>`.

- [ ] **Step 1: Add `findMy` to the service**

In `services/customer-service/src/application/services/reseller.service.ts`, add a method (no depot assertion — a caller reads only their own row):
```ts
  /** The caller's own reseller row (self endpoint), or null if they are not a reseller. */
  async findMy(customerId: string): Promise<Reseller | null> {
    return this.resellers.findById(customerId);
  }
```

- [ ] **Step 2: Write the self controller**

Create `services/customer-service/src/modules/reseller-self.controller.ts`:
```ts
import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthenticatedUser, CurrentUser } from '@hydromart/platform';

import { ResellerService } from '../application/services/reseller.service';

// Customer-facing reseller self endpoint. No @Roles → any authenticated user (the global
// JwtAuthGuard still applies). Lets checkout resolve the caller's own reseller pricing.
@ApiTags('Resellers')
@ApiBearerAuth()
@Controller({ path: 'resellers', version: '1' })
export class ResellerSelfController {
  constructor(private readonly resellers: ResellerService) {}

  @Get('me')
  @ApiOperation({ summary: 'My reseller pricing (active + discount percent)' })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<{ active: boolean; discountPct: number }> {
    const found = await this.resellers.findMy(user.sub);
    if (!found) throw new NotFoundException('Not a reseller');
    return { active: found.active, discountPct: found.discountPct };
  }
}
```

- [ ] **Step 3: Register the controller BEFORE the staff controller**

In `services/customer-service/src/modules/customer.module.ts`, import `ResellerSelfController` and add it to the `controllers` array **immediately before** `ResellerController`, so the static `me` route is registered ahead of the staff `@Get(':customerId')` (ParseUUIDPipe) route:
```ts
    // ...FavoriteController,
    ResellerSelfController,
    ResellerController,
    // InternalController...
```

- [ ] **Step 4: Write the failing test**

Add to `services/customer-service/test/unit/reseller.controller.spec.ts` (or a new spec). The controller is thin — mock `ResellerService`:
```ts
describe('ResellerSelfController', () => {
  const svc = { findMy: jest.fn() };
  const controller = new ResellerSelfController(svc as never);
  const user = { sub: 'cust-1', role: Role.CUSTOMER, phone: null };

  it('returns active + discountPct for a reseller', async () => {
    svc.findMy.mockResolvedValue({ active: true, discountPct: 12 });
    expect(await controller.me(user as never)).toEqual({ active: true, discountPct: 12 });
    expect(svc.findMy).toHaveBeenCalledWith('cust-1');
  });

  it('404s when the caller is not a reseller', async () => {
    svc.findMy.mockResolvedValue(null);
    await expect(controller.me(user as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```
(Import `ResellerSelfController`, `NotFoundException`, and `Role` from the same places the existing spec imports them.)

- [ ] **Step 5: Run tests, typecheck**

Run: `cd services/customer-service && npx jest reseller.controller && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add services/customer-service/src services/customer-service/test
git commit -m "feat(reseller): add GET /resellers/me self pricing endpoint"
```

---

### Task 3: order-service — pure percent-discount helper + voucher-forbidden error

**Files:**
- Modify: `services/order-service/src/domain/pricing.ts` (add `percentDiscount`)
- Modify: `services/order-service/src/domain/errors.ts` (add `ResellerVoucherNotAllowedError`)
- Test: `services/order-service/test/unit/pricing.spec.ts` (extend or create)

**Interfaces:**
- Produces: `percentDiscount(base: number, pct: number): number` (raw, unrounded, floored at 0). `ResellerVoucherNotAllowedError extends DomainError`.

- [ ] **Step 1: Write the failing test for `percentDiscount`**

In `services/order-service/test/unit/pricing.spec.ts` (create if absent), import from `../../src/domain/pricing`:
```ts
import { percentDiscount } from '../../src/domain/pricing';

describe('percentDiscount', () => {
  it('returns the percent of the base', () => {
    expect(percentDiscount(20000, 10)).toBe(2000);
  });
  it('is 0 at 0 percent and full base at 100 percent', () => {
    expect(percentDiscount(20000, 0)).toBe(0);
    expect(percentDiscount(20000, 100)).toBe(20000);
  });
  it('never goes negative', () => {
    expect(percentDiscount(20000, -5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd services/order-service && npx jest pricing`
Expected: FAIL — `percentDiscount is not a function`.

- [ ] **Step 3: Implement `percentDiscount`**

In `services/order-service/src/domain/pricing.ts`, append:
```ts
/** Flat reseller discount: `pct` percent of `base`, floored at 0. Caller rounds via money(). */
export function percentDiscount(base: number, pct: number): number {
  return Math.max(0, (base * pct) / 100);
}
```

- [ ] **Step 4: Add the domain error**

In `services/order-service/src/domain/errors.ts`, mirror `VoucherRejectedError` (business-rule rejection, 422):
```ts
export class ResellerVoucherNotAllowedError extends DomainError {
  readonly code = 'ORDER_RESELLER_VOUCHER_FORBIDDEN';
  readonly status = HTTP_STATUS.UNPROCESSABLE;
  constructor() {
    super('Reseller pricing already applies — vouchers cannot be used on this order.');
  }
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `cd services/order-service && npx jest pricing`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/order-service/src/domain services/order-service/test/unit/pricing.spec.ts
git commit -m "feat(reseller): percent-discount helper + voucher-forbidden error"
```

---

### Task 4: order-service — reseller-discount port, HTTP adapter, config, module wiring

**Files:**
- Create: `services/order-service/src/application/ports/reseller-discount.port.ts`
- Create: `services/order-service/src/infrastructure/http/reseller-discount.http.adapter.ts`
- Modify: `services/order-service/src/application/tokens.ts` (add `ResellerDiscount` token)
- Modify: `services/order-service/src/config/order-config.service.ts` (add `customerServiceUrl`)
- Modify: `services/order-service/src/config/env.validation.ts` (add `CUSTOMER_SERVICE_URL`) — if that file validates env
- Modify: `services/order-service/src/modules/order.module.ts` (bind adapter)
- Test: `services/order-service/test/unit/reseller-discount.http.adapter.spec.ts`

**Interfaces:**
- Produces: `ResellerDiscountPort.get(authorization: string): Promise<ResellerDiscount | null>` where `ResellerDiscount = { active: boolean; discountPct: number }`. Token `ORDER_TOKENS.ResellerDiscount`.

- [ ] **Step 1: Define the port**

Create `services/order-service/src/application/ports/reseller-discount.port.ts`:
```ts
export interface ResellerDiscount {
  active: boolean;
  discountPct: number;
}

/**
 * Resolves the checking-out customer's reseller pricing from customer-service.
 * Fails OPEN: null on any error / timeout / 404 (caller treats null as "not a reseller").
 */
export interface ResellerDiscountPort {
  get(authorization: string): Promise<ResellerDiscount | null>;
}
```

- [ ] **Step 2: Add the token**

In `services/order-service/src/application/tokens.ts`, add to the `ORDER_TOKENS` object:
```ts
  ResellerDiscount: Symbol('ResellerDiscount'),
```

- [ ] **Step 3: Add the config getter**

In `services/order-service/src/config/order-config.service.ts`, mirror `loyaltyServiceUrl`:
```ts
  get customerServiceUrl(): string {
    return this.config.getOrThrow<string>('CUSTOMER_SERVICE_URL').replace(/\/+$/, '');
  }
```
If `env.validation.ts` enumerates required env vars (check for `LOYALTY_SERVICE_URL` there), add `CUSTOMER_SERVICE_URL` alongside it with the same validator. Also add `CUSTOMER_SERVICE_URL=http://customer-service:3000` (matching the sibling service URLs) to any `.env.example` / compose env block that lists `LOYALTY_SERVICE_URL`.

- [ ] **Step 4: Write the failing adapter test**

Create `services/order-service/test/unit/reseller-discount.http.adapter.spec.ts`. Mock `fetch`; mirror any existing `*.http.adapter.spec.ts` for the config stub shape:
```ts
import { ResellerDiscountHttpAdapter } from '../../src/infrastructure/http/reseller-discount.http.adapter';

const config = { customerServiceUrl: 'http://customer' } as never;

describe('ResellerDiscountHttpAdapter', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('returns pricing when the endpoint answers 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ active: true, discountPct: 10 }),
    }) as never;
    const out = await new ResellerDiscountHttpAdapter(config).get('Bearer t');
    expect(out).toEqual({ active: true, discountPct: 10 });
  });

  it('fails open to null on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 }) as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('Bearer t')).toBeNull();
  });

  it('fails open to null on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('Bearer t')).toBeNull();
  });

  it('returns null when no authorization is supplied', async () => {
    global.fetch = jest.fn() as never;
    expect(await new ResellerDiscountHttpAdapter(config).get('')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd services/order-service && npx jest reseller-discount.http.adapter`
Expected: FAIL — cannot find the adapter module.

- [ ] **Step 6: Implement the adapter (mirrors membership.http.adapter.ts)**

Create `services/order-service/src/infrastructure/http/reseller-discount.http.adapter.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';

import { ResellerDiscount, ResellerDiscountPort } from '../../application/ports/reseller-discount.port';
import { OrderConfigService } from '../../config/order-config.service';

@Injectable()
export class ResellerDiscountHttpAdapter implements ResellerDiscountPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(ResellerDiscountHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async get(authorization: string): Promise<ResellerDiscount | null> {
    if (!authorization) return null;
    const url = `${this.config.customerServiceUrl}/api/v1/resellers/me`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ResellerDiscountHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: 'GET', headers: { authorization }, signal: controller.signal });
      if (res.status === 404) return null; // not a reseller
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const body = (await res.json()) as { active?: boolean; discountPct?: number };
      const discountPct = Number(body.discountPct);
      if (!Number.isFinite(discountPct)) return null;
      return { active: body.active === true, discountPct };
    } catch (error) {
      this.logger.warn(`Reseller pricing unavailable: ${(error as Error).message}`);
      return null; // fail open
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 7: Bind the adapter in the module**

In `services/order-service/src/modules/order.module.ts`, add to the providers array (next to the Membership binding):
```ts
    { provide: ORDER_TOKENS.ResellerDiscount, useClass: ResellerDiscountHttpAdapter },
```
Import `ResellerDiscountHttpAdapter` at the top alongside the other `*.http.adapter` imports.

- [ ] **Step 8: Run tests, typecheck**

Run: `cd services/order-service && npx jest reseller-discount.http.adapter && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add services/order-service/src services/order-service/test
git commit -m "feat(reseller): order-service reseller-discount port + adapter"
```

---

### Task 5: order-service — apply reseller pricing in checkout

**Files:**
- Modify: `services/order-service/src/application/services/order.service.ts` (constructor + `checkout` discount block)
- Test: `services/order-service/test/unit/order.service.spec.ts` (extend — mirror existing checkout tests)

**Interfaces:**
- Consumes: `ResellerDiscountPort` (Task 4, token `ORDER_TOKENS.ResellerDiscount`), `percentDiscount` + `ResellerVoucherNotAllowedError` (Task 3).

- [ ] **Step 1: Inject the port**

In `services/order-service/src/application/services/order.service.ts`, add a constructor param (after the `Promo` inject, keeping token style):
```ts
    @Inject(ORDER_TOKENS.ResellerDiscount) private readonly resellerDiscount: ResellerDiscountPort,
```
Add imports at the top:
```ts
import { ResellerDiscountPort } from '../ports/reseller-discount.port';
import { percentDiscount } from '../../domain/pricing';
import { ResellerVoucherNotAllowedError } from '../../domain/errors';
```
(`percentDiscount` may share the existing `../../domain/pricing` import — merge into it. `ResellerVoucherNotAllowedError` likewise merges into the existing `../../domain/errors` import.)

- [ ] **Step 2: Replace the discount block**

In `checkout`, replace the existing membership + voucher + combined-discount block (currently `order.service.ts:170-191`, from the `// FR-032` comment through `const total = money(subtotal + deliveryFee - discount);`) with:
```ts
    // Reseller pricing (reseller-only): an active reseller with a percent gets a flat
    // discount off subtotal and NO membership/voucher. Fails open (null → normal pricing).
    const reseller = await this.resellerDiscount.get(authorization ?? '');
    const isReseller = reseller?.active === true && reseller.discountPct > 0;

    // voucherCode is null for resellers so the later redeem block is skipped too.
    const voucherCode = isReseller ? null : input.voucherCode?.trim().toUpperCase() || null;

    let discount: number;
    if (isReseller) {
      if (input.voucherCode?.trim()) throw new ResellerVoucherNotAllowedError();
      discount = money(Math.min(subtotal, percentDiscount(subtotal, reseller!.discountPct)));
    } else {
      // FR-032: the customer's membership tier gives an always-on discount on the
      // subtotal. Fails OPEN (0 rate) so a loyalty outage never blocks checkout.
      const membershipRate = await this.membership.getDiscountRate(authorization);
      const membershipDiscount = money(subtotal * membershipRate);

      // A supplied voucher is validated + priced by the promo-service. Fails CLOSED:
      // an invalid or unreachable voucher rejects checkout (VoucherRejectedError).
      let voucherDiscount = 0;
      if (voucherCode) {
        const quote = await this.promo.quote(voucherCode, customerId, subtotal, deliveryFee, authorization);
        voucherDiscount = quote.discount;
      }

      // Membership + voucher stack, capped at the whole bill (a FREE_SHIPPING voucher
      // discounts against the delivery fee, so the ceiling is subtotal + deliveryFee).
      discount = money(Math.min(subtotal + deliveryFee, membershipDiscount + voucherDiscount));
    }
    const total = money(subtotal + deliveryFee - discount);
```
The existing redeem block later (`if (voucherCode) { await this.promo.redeem(...) }`) is unchanged and correctly skipped when `voucherCode` is null (resellers).

- [ ] **Step 3: Write failing checkout tests**

In `services/order-service/test/unit/order.service.spec.ts`, add a fake reseller port to the service construction (find where the service is built — add a `resellerDiscount` stub returning `null` by default so existing tests keep the normal path), then add:
```ts
  it('applies reseller percent discount and skips membership + voucher', async () => {
    resellerDiscount.get.mockResolvedValue({ active: true, discountPct: 10 });
    membership.getDiscountRate.mockResolvedValue(0.05); // must be ignored
    // ...seed a cart whose subtotal is 20000 (reuse the spec's existing cart-seed helper)...
    const order = await service.checkout(CUSTOMER_ID, { deliveryAddress: ADDRESS }, TOKEN);
    expect(order.discount).toBe(2000);          // 10% of 20000, membership 5% ignored
    expect(membership.getDiscountRate).not.toHaveBeenCalled();
    expect(promo.quote).not.toHaveBeenCalled();
  });

  it('rejects a voucher for an active reseller', async () => {
    resellerDiscount.get.mockResolvedValue({ active: true, discountPct: 10 });
    await expect(
      service.checkout(CUSTOMER_ID, { deliveryAddress: ADDRESS, voucherCode: 'SAVE5' }, TOKEN),
    ).rejects.toBeInstanceOf(ResellerVoucherNotAllowedError);
  });

  it('uses normal membership pricing when not a reseller', async () => {
    resellerDiscount.get.mockResolvedValue(null);
    membership.getDiscountRate.mockResolvedValue(0.05);
    const order = await service.checkout(CUSTOMER_ID, { deliveryAddress: ADDRESS }, TOKEN);
    expect(membership.getDiscountRate).toHaveBeenCalled();
    expect(order.discount).toBe(1000);          // 5% of 20000
  });

  it('falls back to normal pricing when reseller lookup fails open (null)', async () => {
    resellerDiscount.get.mockResolvedValue(null);
    // voucher path still available
    expect(true).toBe(true);
  });
```
Use the spec's existing constants (`CUSTOMER_ID`, `ADDRESS`, `TOKEN`) and cart/catalog seeding helpers; match the real subtotal your seed produces and adjust the expected numbers accordingly.

- [ ] **Step 4: Run to verify fail → pass**

Run: `cd services/order-service && npx jest order.service`
Expected: the new tests FAIL before Step 2, PASS after. Existing checkout tests stay green (default reseller stub returns null).

- [ ] **Step 5: Typecheck + commit**

Run: `cd services/order-service && npx tsc --noEmit`
Expected: No errors.
```bash
git add services/order-service/src services/order-service/test
git commit -m "feat(reseller): apply reseller pricing at checkout (skip membership + voucher)"
```

---

### Task 6: web — `discountPct` in the `/resellers` console

**Files:**
- Modify: `apps/web/src/lib/reseller.ts` (add `discountPct` to `Reseller`)
- Modify: `apps/web/src/app/resellers/page.tsx` (register form + edit row + row display)
- Test: `apps/web/test/` (extend the reseller vitest if present)

**Interfaces:**
- Consumes: `Reseller.discountPct` (server, Task 1). Register/patch send `discountPct` (number).

- [ ] **Step 1: Add the field to the web type**

In `apps/web/src/lib/reseller.ts`, add to the `Reseller` interface (after `monthlyTargetQty`):
```ts
  discountPct: number;
```

- [ ] **Step 2: Add a discount input to the register form**

In `apps/web/src/app/resellers/page.tsx`, in `RegisterResellerForm`, add a `discount` state and a field. Add near the other `useState`:
```tsx
  const [discount, setDiscount] = useState('');
```
Add a `<Field>` inside the form grid (after the target field), and include `discountPct` in the POST body:
```tsx
        <Field label="Diskon reseller (%)" hint="0–100, kosong = 0">
          <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="10" />
        </Field>
```
In the `api.post(endpoints.resellers.create, {...})` body add:
```tsx
          discountPct: Number(discount) || 0,
```
And clear it in the success reset: `setDiscount('');`. Add a bound check before submit (alongside the target check):
```tsx
    if (discount !== '' && !(Number(discount) >= 0 && Number(discount) <= 100)) {
      setError('Diskon harus 0–100.');
      return;
    }
```

- [ ] **Step 3: Add discount to the inline edit row**

In `ResellerRow`, add an edit state + field. Near the other row state:
```tsx
  const [discount, setDiscount] = useState(String(r.discountPct));
```
In `openEdit()` add `setDiscount(String(r.discountPct));`. In the editing JSX grid add a field:
```tsx
          <Field label="Diskon (%)">
            <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </Field>
```
In `saveEdit()`, validate + include in the PATCH body:
```tsx
    if (!(Number(discount) >= 0 && Number(discount) <= 100)) {
      notify('Diskon harus 0–100.', 'error');
      return;
    }
```
and add `discountPct: Number(discount)` to the `api.patch(endpoints.resellers.detail(r.customerId), {...})` body.

- [ ] **Step 4: Show the discount on the collapsed row**

In `ResellerRow`'s non-editing view, add to the muted metrics line (after the volume/target text) a discount chip when set:
```tsx
          {r.discountPct > 0 && <> · diskon {r.discountPct}%</>}
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/reseller.ts apps/web/src/app/resellers/page.tsx
git commit -m "feat(reseller): edit + show reseller discount percent in console"
```

---

### Task 7: web — hide voucher + show reseller badge at checkout

**Files:**
- Modify: `apps/web/src/lib/endpoints.ts` (add `resellers.me`)
- Modify: `apps/web/src/app/checkout/page.tsx` (fetch reseller/me, gate voucher UI, badge)

**Interfaces:**
- Consumes: `GET /resellers/me` → `{ active, discountPct }` or 404 (Task 2).

- [ ] **Step 1: Add the endpoint**

In `apps/web/src/lib/endpoints.ts`, inside the `resellers` object, add:
```ts
    me: '/customers/api/v1/resellers/me',
```

- [ ] **Step 2: Fetch reseller pricing (fail-soft) in checkout**

In `apps/web/src/app/checkout/page.tsx`, add a fetch near the other data loads. If the page uses `useAsync` (as `/resellers` does), mirror it; otherwise `useEffect`+`useState`. Fail-soft: a non-reseller 404 → null.
```tsx
  const reseller = useAsync<{ active: boolean; discountPct: number } | null>(
    () =>
      api
        .get<{ active: boolean; discountPct: number }>(endpoints.resellers.me, true)
        .catch(() => null),
    [],
  );
  const isReseller = !!reseller.data?.active && reseller.data.discountPct > 0;
```
(Import `useAsync` from `@/lib/use-async` if not already imported.)

- [ ] **Step 3: Hide the voucher card for resellers, show a badge**

Wrap the voucher `Card` (currently `checkout/page.tsx:613-639`, the `{/* Voucher */}` block) so it only renders for non-resellers, and render a reseller note instead:
```tsx
      {isReseller ? (
        <Card className="p-4">
          <Badge tone="success">Harga reseller −{reseller.data!.discountPct}%</Badge>
          <p className="mt-2 text-sm text-muted">
            Diskon reseller berlaku otomatis. Voucher tidak bisa dipakai bersama harga reseller.
          </p>
        </Card>
      ) : (
        /* existing voucher Card JSX (unchanged) */
      )}
```
(Import `Badge` from `@/components/ui` if not already imported.) Because the voucher input is hidden, `voucherCode` stays `''`, so `placeOrder`'s body sends `voucherCode: undefined` for resellers — the server never sees a voucher.

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/endpoints.ts apps/web/src/app/checkout/page.tsx
git commit -m "feat(reseller): hide voucher + show reseller badge at checkout"
```

---

## Final verification (after all tasks)

- [ ] Run each service's full unit suite with coverage (CI parity — see the subagent-verify memory):
  - `cd services/customer-service && npx jest --coverage`
  - `cd services/order-service && npx jest --coverage`
- [ ] Lint the `{src,test}` of both services (CI lints test too): `npx eslint src test` in each.
- [ ] `cd apps/web && npx tsc --noEmit && npx vitest run` (whatever the web test runner is).
- [ ] Confirm the `reseller_discount_pct` migration exists and is applied to **dev** only. Prod apply is deferred with the other pending migrations (needs VPS access + care on live data).
- [ ] Manual smoke (optional, if stack is up): set a reseller's discount in `/resellers`; log in as that customer; checkout shows the reseller badge, no voucher field, and the order total reflects the flat percent with no membership/voucher.

## Notes

- Reseller pricing is fail-open on the order-service side: if customer-service is down, a reseller pays normal price and could use a voucher for that window. Acceptable — never block a checkout on a pricing-lookup outage (matches the membership adapter).
- `discountPct` defaults to 0, so every existing reseller behaves exactly as today until a percent is set.
- `placeScheduled` (subscriptions) intentionally untouched — out of scope.
