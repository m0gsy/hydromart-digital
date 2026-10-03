# Mesin Promo Auto-Apply — Plan 2: order-service Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Plan 1's `promo-service` auto-apply engine into `order-service`'s two real
checkout paths — `checkout()` (customer app/web) and `walkInSale()` (depot counter) — so
`SPECIAL_PRICE`/`BUY_X_GET_Y`/`SHIPPING_DISCOUNT` rules actually adjust what a customer or
counter buyer is charged, and record the audit trail via `/promotions/auto-apply/apply`
after the order is created.

**Architecture:** A new `PromoAutoApplyPort`, implemented by an HTTP adapter that is
**fail-open by construction** — it never throws; any failure (unreachable, timeout,
non-2xx) resolves to a neutral "nothing matched" result, logged as a warning. A pure domain
function (`applyPromoQuote`) merges that result into the already-priced `CreateOrderItemData[]`
array (adjusts unit price, adds a separate zero-price row for BUY_X_GET_Y free units,
recomputes subtotal). Both checkout paths call the port then the merge function right after
their existing `priceLines()` call, before any voucher/membership discount logic runs — the
same point in the pipeline both paths already share. After the order is persisted, both
paths call `/auto-apply/apply` (fire-and-forget, fail-open, mirrors how `notification.notify`
is already called) to record `PromoApplication` audit rows.

**Tech Stack:** Same as the rest of `order-service` — NestJS, TypeScript, Jest.

## Global Constraints

- **Known scope limitation, stated explicitly, not a gap to silently work around:**
  `order-service`'s priced lines (`PricedLine`/`CreateOrderItemData`) carry no `categoryId`
  today — adding it would mean touching `depot-service`'s and `product-service`'s pricing
  lookups, out of scope for this plan. Every call this plan makes to
  `/promotions/auto-apply/quote` / `/apply` sends `categoryId: null` for every line. A
  category-scoped `PromoRule` (one created with `productId: null, categoryId: <uuid>`) will
  simply never match at real checkout until a later plan adds that plumbing — only
  `productId`-scoped and fully-unscoped rules are reachable from production traffic after
  this plan. Document this where the HTTP adapter builds its payload (Task 1).
- **Stacking decision, made here, not asked of the user again:** promo auto-apply and
  Voucher are independent discount sources, same relationship membership already has with
  Voucher in this file (`membershipDiscount + voucherValueDiscount`, both capped together at
  `subtotal`). Promo auto-apply is computed FIRST (it changes what `subtotal`/`shippingFee`
  even ARE), then voucher quoting runs exactly as today against the promo-adjusted numbers.
  BR-015 ("no voucher stacking") is unaffected — it is still exactly one voucher code at a
  time; this plan adds a second, automatic, uncoded discount source alongside it.
- **The port never throws.** Every method on `PromoAutoApplyPort` resolves; the HTTP adapter
  catches everything and returns the neutral/empty shape. This is the simplest correct
  expression of "fail open" — no call site needs its own try/catch.
- **The counter path calls `/auto-apply/quote` twice per delivery sale** (once inside
  `counterShippingFee` to resolve the shipping override, once inside `priceCounterBasket` to
  resolve the item-level adjustments) — a deliberate, stated trade-off rather than
  restructuring `walkInSale`'s two pre-existing `priceLines` calls into one. Both calls are
  read-only and idempotent; the redundancy costs one extra HTTP round-trip on a delivery
  counter sale, never on a pick-up (no shipping fee to quote) and never on the app path.
- Money stays integer rupiah via `money()` everywhere a new total is computed, same as every
  existing line in this file.
- Every exported type/method a later task consumes is defined with its exact name in the
  task that introduces it.

---

### Task 1: `PromoAutoApplyPort` + fail-open HTTP adapter

**Files:**
- Create: `services/order-service/src/application/ports/promo-auto-apply.port.ts`
- Create: `services/order-service/src/infrastructure/http/promo-auto-apply.http.adapter.ts`
- Test: `services/order-service/test/unit/promo-auto-apply.http.adapter.spec.ts`
- Modify: `services/order-service/src/application/tokens.ts`
- Modify: `services/order-service/src/modules/order.module.ts`

**Interfaces:**
- Consumes: `OrderConfigService.promoServiceUrl` / `.internalServiceKey` (already exist,
  used by the sibling `PromoHttpAdapter`).
- Produces (consumed by Task 2):
  - `type AutoApplyChannel = 'APP' | 'COUNTER'`
  - `interface AutoApplyCartLine { productId: string; quantity: number; unitPrice: number }`
  - `interface AutoApplyLineResult { productId: string; appliedRuleIds: string[]; unitPriceAfter: number; freeQty: number; lineTotal: number }`
  - `interface AutoApplyQuoteResult { lines: AutoApplyLineResult[]; shippingAppliedRuleId: string | null; shippingFeeOverride: number | null }`
  - `interface PromoAutoApplyPort` with:
    - `quote(depotId: string | null, channel: AutoApplyChannel, lines: AutoApplyCartLine[]): Promise<AutoApplyQuoteResult>` — never throws.
    - `apply(orderId: string, depotId: string | null, channel: AutoApplyChannel, lines: AutoApplyCartLine[]): Promise<void>` — never throws, fire-and-forget.
  - `ORDER_TOKENS.PromoAutoApply: Symbol`

- [ ] **Step 1: Write the port interface**

Create `services/order-service/src/application/ports/promo-auto-apply.port.ts`:

```typescript
/**
 * Talks to promo-service's auto-apply engine (item 5 fase 1, see
 * docs/superpowers/specs/2026-10-02-promo-auto-apply-engine-design.md). Unlike `PromoPort`
 * (customer-typed voucher codes, fails CLOSED), this is a BACKGROUND pricing optimization —
 * nothing the customer typed, nothing they are promised by name at the point of checkout —
 * so both methods fail OPEN: an unreachable or erroring promo-service must never block a
 * checkout, it must simply mean no auto-promo was applied.
 */
export type AutoApplyChannel = 'APP' | 'COUNTER';

export interface AutoApplyCartLine {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface AutoApplyLineResult {
  productId: string;
  appliedRuleIds: string[];
  unitPriceAfter: number;
  freeQty: number;
  lineTotal: number;
}

export interface AutoApplyQuoteResult {
  lines: AutoApplyLineResult[];
  shippingAppliedRuleId: string | null;
  shippingFeeOverride: number | null;
}

export interface PromoAutoApplyPort {
  /** Never throws. Returns a neutral result (no line touched) on any failure. */
  quote(
    depotId: string | null,
    channel: AutoApplyChannel,
    lines: AutoApplyCartLine[],
  ): Promise<AutoApplyQuoteResult>;

  /**
   * Records the audit trail for an order already created. Fire-and-forget: never throws,
   * a failure here only means `PromoApplication` rows are missing for this order, never
   * that the order itself is wrong — the price was already locked in by `quote`.
   */
  apply(
    orderId: string,
    depotId: string | null,
    channel: AutoApplyChannel,
    lines: AutoApplyCartLine[],
  ): Promise<void>;
}
```

- [ ] **Step 2: Add the token**

Modify `services/order-service/src/application/tokens.ts` — find the `ORDER_TOKENS` object
and add one line (alphabetical position does not matter, this repo does not enforce it —
check the existing file's own ordering and match it):

```typescript
  PromoAutoApply: Symbol('PromoAutoApply'),
```

- [ ] **Step 3: Write the failing adapter tests**

Create `services/order-service/test/unit/promo-auto-apply.http.adapter.spec.ts`:

```typescript
import { PromoAutoApplyHttpAdapter } from '../../src/infrastructure/http/promo-auto-apply.http.adapter';
import { OrderConfigService } from '../../src/config/order-config.service';

const config = (overrides: Partial<OrderConfigService> = {}): OrderConfigService =>
  ({
    promoServiceUrl: 'http://promo-service',
    internalServiceKey: 'test-internal-key',
    ...overrides,
  }) as OrderConfigService;

describe('PromoAutoApplyHttpAdapter', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('quote', () => {
    it('sends categoryId: null for every line (fase 1 scope limitation)', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      await adapter.quote('depot-1', 'APP', [{ productId: 'p1', quantity: 2, unitPrice: 8000 }]);
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.lines[0]).toEqual({
        productId: 'p1',
        categoryId: null,
        quantity: 2,
        unitPrice: 8000,
      });
      expect(body.depotId).toBe('depot-1');
      expect(body.channel).toBe('APP');
    });

    it('returns the parsed result on a 200', async () => {
      const expected = {
        lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 7000, freeQty: 0, lineTotal: 7000 }],
        shippingAppliedRuleId: null,
        shippingFeeOverride: null,
      };
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => expected }) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual(expected);
    });

    it('fails open (empty result) when fetch rejects', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null });
    });

    it('fails open when the response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null });
    });

    it('fails open when internalServiceKey is missing', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config({ internalServiceKey: '' }));
      const result = await adapter.quote('depot-1', 'APP', []);
      expect(result).toEqual({ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('posts orderId + lines and resolves on success', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      await expect(
        adapter.apply('order-1', 'depot-1', 'COUNTER', [{ productId: 'p1', quantity: 1, unitPrice: 8000 }]),
      ).resolves.toBeUndefined();
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.orderId).toBe('order-1');
    });

    it('fails open (resolves) when fetch rejects', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config());
      await expect(adapter.apply('order-1', 'depot-1', 'APP', [])).resolves.toBeUndefined();
    });

    it('fails open when internalServiceKey is missing', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof fetch;
      const adapter = new PromoAutoApplyHttpAdapter(config({ internalServiceKey: '' }));
      await expect(adapter.apply('order-1', 'depot-1', 'APP', [])).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd services/order-service
npx jest test/unit/promo-auto-apply.http.adapter.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/infrastructure/http/promo-auto-apply.http.adapter'`.

- [ ] **Step 5: Write the adapter**

Create `services/order-service/src/infrastructure/http/promo-auto-apply.http.adapter.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import {
  AutoApplyCartLine,
  AutoApplyChannel,
  AutoApplyQuoteResult,
  PromoAutoApplyPort,
} from '../../application/ports/promo-auto-apply.port';

const EMPTY_QUOTE: AutoApplyQuoteResult = {
  lines: [],
  shippingAppliedRuleId: null,
  shippingFeeOverride: null,
};

@Injectable()
export class PromoAutoApplyHttpAdapter implements PromoAutoApplyPort {
  private static readonly TIMEOUT_MS = 3000;
  private readonly logger = new Logger(PromoAutoApplyHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async quote(
    depotId: string | null,
    channel: AutoApplyChannel,
    lines: AutoApplyCartLine[],
  ): Promise<AutoApplyQuoteResult> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn('Auto-apply promo quote skipped: no internal service key');
      return EMPTY_QUOTE;
    }
    try {
      const res = await fetch(`${this.config.promoServiceUrl}/api/v1/promotions/auto-apply/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          depotId,
          channel,
          // Fase 1 scope limitation: no categoryId plumbing yet (see Plan 2's Global
          // Constraints). Category-scoped PromoRules never match from this call.
          lines: lines.map((l) => ({
            productId: l.productId,
            categoryId: null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        }),
        signal: AbortSignal.timeout(PromoAutoApplyHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Auto-apply promo quote responded ${res.status}`);
        return EMPTY_QUOTE;
      }
      const body = (await res.json()) as AutoApplyQuoteResult;
      return {
        lines: body.lines ?? [],
        shippingAppliedRuleId: body.shippingAppliedRuleId ?? null,
        shippingFeeOverride: body.shippingFeeOverride ?? null,
      };
    } catch (error) {
      this.logger.warn(`Auto-apply promo quote unreachable: ${(error as Error).message}`);
      return EMPTY_QUOTE;
    }
  }

  async apply(
    orderId: string,
    depotId: string | null,
    channel: AutoApplyChannel,
    lines: AutoApplyCartLine[],
  ): Promise<void> {
    const { internalServiceKey } = this.config;
    if (!internalServiceKey) {
      this.logger.warn(`Auto-apply promo record skipped for order ${orderId}: no internal service key`);
      return;
    }
    try {
      const res = await fetch(`${this.config.promoServiceUrl}/api/v1/promotions/auto-apply/apply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          orderId,
          depotId,
          channel,
          lines: lines.map((l) => ({
            productId: l.productId,
            categoryId: null,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        }),
        signal: AbortSignal.timeout(PromoAutoApplyHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Auto-apply promo record failed for order ${orderId}: responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Auto-apply promo record failed for order ${orderId}: ${(error as Error).message}`);
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd services/order-service
npx jest test/unit/promo-auto-apply.http.adapter.spec.ts
```

Expected: PASS, all 9 tests green.

- [ ] **Step 7: Wire the module**

Modify `services/order-service/src/modules/order.module.ts` — add the import next to
`PromoHttpAdapter`'s:

```typescript
import { PromoAutoApplyHttpAdapter } from '../infrastructure/http/promo-auto-apply.http.adapter';
```

And add the provider next to `ORDER_TOKENS.Promo`'s:

```typescript
  { provide: ORDER_TOKENS.PromoAutoApply, useClass: PromoAutoApplyHttpAdapter },
```

- [ ] **Step 8: Commit**

```bash
git add services/order-service/src/application/ports/promo-auto-apply.port.ts services/order-service/src/infrastructure/http/promo-auto-apply.http.adapter.ts services/order-service/src/application/tokens.ts services/order-service/src/modules/order.module.ts services/order-service/test/unit/promo-auto-apply.http.adapter.spec.ts
git commit -m "feat(order): PromoAutoApplyPort + fail-open HTTP adapter"
```

---

### Task 2: Pure merge function — apply a promo quote to priced items

**Files:**
- Create: `services/order-service/src/domain/promo-adjustment.ts`
- Test: `services/order-service/test/unit/promo-adjustment.spec.ts`

**Interfaces:**
- Consumes: `AutoApplyQuoteResult` (Task 1), `CreateOrderItemData` (already exists in
  `services/order-service/src/application/ports/order.repository.ts`).
- Produces (consumed by Task 4 and Task 5):
  - `function applyPromoQuote(items: CreateOrderItemData[], quote: AutoApplyQuoteResult): { items: CreateOrderItemData[]; subtotal: number }`
  - `function reservationLinesFor(items: CreateOrderItemData[]): { productId: string; quantity: number }[]` — sums quantity per `productId` across however many `CreateOrderItemData` rows share it (needed because a `BUY_X_GET_Y` winner now produces TWO rows for the same product).

- [ ] **Step 1: Write the failing tests**

Create `services/order-service/test/unit/promo-adjustment.spec.ts`:

```typescript
import { CreateOrderItemData } from '../../src/application/ports/order.repository';
import { AutoApplyQuoteResult } from '../../src/application/ports/promo-auto-apply.port';
import { applyPromoQuote, reservationLinesFor } from '../../src/domain/promo-adjustment';

const item = (overrides: Partial<CreateOrderItemData> = {}): CreateOrderItemData => ({
  productId: 'p1',
  productName: 'Galon 19L',
  sku: 'GAL-19',
  unit: 'galon',
  volumeMl: 19000,
  isGallon: true,
  unitPrice: 8000,
  quantity: 2,
  lineTotal: 16000,
  ...overrides,
});

const emptyQuote: AutoApplyQuoteResult = {
  lines: [],
  shippingAppliedRuleId: null,
  shippingFeeOverride: null,
};

describe('applyPromoQuote', () => {
  it('leaves items and subtotal unchanged when nothing matched', () => {
    const result = applyPromoQuote([item()], emptyQuote);
    expect(result.items).toEqual([item()]);
    expect(result.subtotal).toBe(16000);
  });

  it('applies a SPECIAL_PRICE adjustment: same row, new unitPrice/lineTotal', () => {
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 7000, freeQty: 0, lineTotal: 14000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote([item()], quote);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ unitPrice: 7000, quantity: 2, lineTotal: 14000 });
    expect(result.subtotal).toBe(14000);
  });

  it('adds a separate zero-price row for BUY_X_GET_Y free units', () => {
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 8000, freeQty: 2, lineTotal: 16000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote([item()], quote);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ productId: 'p1', quantity: 2, unitPrice: 8000, lineTotal: 16000 });
    expect(result.items[1]).toMatchObject({ productId: 'p1', quantity: 2, unitPrice: 0, lineTotal: 0 });
    // Free row keeps the same catalog identity (name/sku/unit/volumeMl/isGallon) so stock,
    // galon counting and the receipt all still recognise what product it is.
    expect(result.items[1]).toMatchObject({
      productName: 'Galon 19L',
      sku: 'GAL-19',
      unit: 'galon',
      volumeMl: 19000,
      isGallon: true,
    });
    expect(result.subtotal).toBe(16000);
  });

  it('leaves a line with no matching quote result untouched', () => {
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'other-product', appliedRuleIds: ['r1'], unitPriceAfter: 1, freeQty: 0, lineTotal: 1 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote([item()], quote);
    expect(result.items).toEqual([item()]);
    expect(result.subtotal).toBe(16000);
  });

  it('sums subtotal correctly across several lines, some adjusted some not', () => {
    const items = [item(), item({ productId: 'p2', unitPrice: 5000, quantity: 1, lineTotal: 5000 })];
    const quote: AutoApplyQuoteResult = {
      lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 6000, freeQty: 0, lineTotal: 12000 }],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    };
    const result = applyPromoQuote(items, quote);
    expect(result.subtotal).toBe(17000); // 12000 (p1 after promo) + 5000 (p2 untouched)
  });
});

describe('reservationLinesFor', () => {
  it('returns one line per distinct productId when there is no split', () => {
    expect(reservationLinesFor([item()])).toEqual([{ productId: 'p1', quantity: 2 }]);
  });

  it('sums quantity across a paid row and a free row for the same product', () => {
    const items = [item({ quantity: 2 }), item({ unitPrice: 0, quantity: 2, lineTotal: 0 })];
    expect(reservationLinesFor(items)).toEqual([{ productId: 'p1', quantity: 4 }]);
  });

  it('keeps separate products separate', () => {
    const items = [item(), item({ productId: 'p2', quantity: 1 })];
    expect(reservationLinesFor(items)).toEqual(
      expect.arrayContaining([
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 1 },
      ]),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd services/order-service
npx jest test/unit/promo-adjustment.spec.ts
```

Expected: FAIL — `Cannot find module '../../src/domain/promo-adjustment'`.

- [ ] **Step 3: Write the implementation**

Create `services/order-service/src/domain/promo-adjustment.ts`:

```typescript
// Merges a promo-service auto-apply quote (item 5 fase 1) into already-priced order items.
// Pure — no I/O. Called right after `priceLines()` on both checkout paths, before any
// voucher/membership discount logic, so `subtotal` downstream already reflects the promo.

import { CreateOrderItemData } from '../application/ports/order.repository';
import { AutoApplyQuoteResult } from '../application/ports/promo-auto-apply.port';

export function applyPromoQuote(
  items: CreateOrderItemData[],
  quote: AutoApplyQuoteResult,
): { items: CreateOrderItemData[]; subtotal: number } {
  const byProduct = new Map(quote.lines.map((l) => [l.productId, l]));
  const result: CreateOrderItemData[] = [];

  for (const original of items) {
    const line = byProduct.get(original.productId);
    if (!line) {
      result.push(original);
      continue;
    }
    result.push({
      ...original,
      unitPrice: line.unitPriceAfter,
      lineTotal: line.unitPriceAfter * original.quantity,
    });
    if (line.freeQty > 0) {
      // A separate row, not a split within the same row — `CreateOrderItemData` carries one
      // unitPrice/quantity/lineTotal per row, so a free portion at a DIFFERENT price (zero)
      // has to be its own row. Same catalog identity as the paid row so stock, galon
      // counting (`isGallon`) and the receipt still recognise what product it is.
      result.push({
        ...original,
        unitPrice: 0,
        quantity: line.freeQty,
        lineTotal: 0,
      });
    }
  }

  const subtotal = result.reduce((sum, i) => sum + i.lineTotal, 0);
  return { items: result, subtotal };
}

/**
 * Stock to reserve, summed by productId. Needed because `applyPromoQuote` can produce two
 * `CreateOrderItemData` rows (paid + free) for one product — `reserveThenCreate`'s existing
 * `data.items.map(...)` would otherwise send inventory-service two separate reserve lines
 * for the same product, which this repo's inventory port has never had to handle and should
 * not be asked to guess about.
 */
export function reservationLinesFor(
  items: CreateOrderItemData[],
): { productId: string; quantity: number }[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  return [...totals.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest test/unit/promo-adjustment.spec.ts
```

Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/order-service/src/domain/promo-adjustment.ts services/order-service/test/unit/promo-adjustment.spec.ts
git commit -m "feat(order): pure merge of a promo auto-apply quote into priced items"
```

---

### Task 3: Fix `reserveThenCreate` to reserve summed quantities

**Files:**
- Modify: `services/order-service/src/application/services/order.service.ts` (one line, inside
  `private async reserveThenCreate`, currently around line 1991 — search for
  `const lines = data.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));`)
- Test: `services/order-service/test/unit/order.service.spec.ts` (existing file — add new
  `describe` block)

**Interfaces:**
- Consumes: `reservationLinesFor` from Task 2.

- [ ] **Step 1: Find the exact current line**

Open `services/order-service/src/application/services/order.service.ts` and locate (inside
`private async reserveThenCreate`):

```typescript
    const id = randomUUID();
    const lines = data.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
    await this.inventory.reserve(depotId, id, lines, authorization);
```

- [ ] **Step 2: Write the failing test**

Open `services/order-service/test/unit/order.service.spec.ts`, find the existing test suite
structure (it already has a fake `InventoryPort` — reuse it; do not build a second one),
and add:

```typescript
  describe('reserveThenCreate stock reservation', () => {
    it('sums quantity across two items that share a productId (promo free-unit row)', async () => {
      // This test exercises `checkout()` with a cart that, after promo-service is mocked to
      // return a BUY_X_GET_Y match, produces two CreateOrderItemData rows for one product.
      // Wire it through whichever existing fixture this file's other `checkout()` tests use
      // to mock `this.promo`/pricing — add a second row for the same productId to that cart,
      // call `checkout()`, and assert on the fake InventoryPort's `reserve` call:
      // expect(fakeInventory.reserveCalls[0].items).toEqual(
      //   expect.arrayContaining([{ productId: 'p1', quantity: <summed total> }]),
      // );
      // and that the array has exactly ONE entry for 'p1', not two.
    });
  });
```

**Note:** the exact fixture wiring above depends on this spec file's existing test
scaffolding, which this plan has not reproduced in full (it is a very large pre-existing
file). The implementer reads the file's existing `checkout()` tests immediately above this
new block, copies their setup pattern verbatim (same fake ports, same `OrderService`
construction), and fills in the cart/mock details so the two-rows-same-product case is
genuinely exercised end to end. This is the one step in this plan that is deliberately
left to be matched against the live file rather than reproduced blind — every other step
in this plan is complete, runnable code.

- [ ] **Step 3: Apply the one-line fix**

Replace the line found in Step 1 with:

```typescript
    const id = randomUUID();
    const lines = reservationLinesFor(data.items);
    await this.inventory.reserve(depotId, id, lines, authorization);
```

Add the import near the top of the file, alongside the other `../domain/` imports:

```typescript
import { reservationLinesFor } from '../../domain/promo-adjustment';
```

- [ ] **Step 4: Run the full order-service test suite**

```bash
cd services/order-service
npx jest
```

Expected: PASS — every pre-existing test still green (summing quantities for distinct
productIds, the overwhelmingly common case, produces the exact same array `.map()` did), plus
the new test from Step 2.

- [ ] **Step 5: Commit**

```bash
git add services/order-service/src/application/services/order.service.ts services/order-service/test/unit/order.service.spec.ts
git commit -m "fix(order): reserve summed stock per product, not per order-item row"
```

---

### Task 4: Wire into `checkout()` (app path)

**Files:**
- Modify: `services/order-service/src/application/services/order.service.ts`

**Interfaces:**
- Consumes: `PromoAutoApplyPort` (Task 1), `applyPromoQuote` (Task 2),
  `ORDER_TOKENS.PromoAutoApply` (Task 1).

- [ ] **Step 1: Inject the port**

Find the `OrderService` constructor (search for `@Inject(ORDER_TOKENS.Promo)`) and add a
sibling injection right after it:

```typescript
    @Inject(ORDER_TOKENS.PromoAutoApply) private readonly promoAutoApply: PromoAutoApplyPort,
```

Add the import near the other port imports (alongside `import { PromoPort } from
'../ports/promo.port';`):

```typescript
import { PromoAutoApplyPort } from '../ports/promo-auto-apply.port';
import { applyPromoQuote } from '../../domain/promo-adjustment';
```

- [ ] **Step 2: Insert the auto-apply step right after pricing**

Find this block in `checkout()` (currently around line 449-461):

```typescript
    const [
      { items, subtotal, tierPricedTotal, tieredProductIds, catalogFallback },
      resellerLookup,
    ] = await Promise.all([
      this.priceLines(depot.id, lines),
      this.resellerDiscount.get(authorization),
    ]);
    // A5: `unavailable` is the half that used to be thrown away. The price still falls back
    // to retail — a customer-service outage must not stop anyone ordering water — but the
    // order now says that is what happened.
    const reseller = resellerLookup.reseller;
    const resellerUnavailable = resellerLookup.unavailable;
```

Replace it with (new lines marked; everything else identical):

```typescript
    const [
      { items: pricedItems, subtotal: pricedSubtotal, tierPricedTotal, tieredProductIds, catalogFallback },
      resellerLookup,
    ] = await Promise.all([
      this.priceLines(depot.id, lines),
      this.resellerDiscount.get(authorization),
    ]);
    // A5: `unavailable` is the half that used to be thrown away. The price still falls back
    // to retail — a customer-service outage must not stop anyone ordering water — but the
    // order now says that is what happened.
    const reseller = resellerLookup.reseller;
    const resellerUnavailable = resellerLookup.unavailable;

    // Item 5 fase 1: auto-apply promo rules (SPECIAL_PRICE/BUY_X_GET_Y), computed BEFORE
    // membership/voucher discounting — see Plan 2's Global Constraints for the stacking
    // decision. Fails open by construction (the port never throws).
    const autoPromoQuote = await this.promoAutoApply.quote(
      depot.id,
      'APP',
      pricedItems.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
    );
    const { items, subtotal } = applyPromoQuote(pricedItems, autoPromoQuote);
```

- [ ] **Step 3: Apply the shipping override**

Find this line (currently around line 467):

```typescript
    const shippingFee = money(depot.deliveryFee * galonQuantity(items));
```

Replace it with:

```typescript
    // Item 5 fase 1: a SHIPPING_DISCOUNT promo replaces the depot's own per-galon fee.
    const perGalonFee = autoPromoQuote.shippingFeeOverride ?? depot.deliveryFee;
    const shippingFee = money(perGalonFee * galonQuantity(items));
```

- [ ] **Step 4: Record the audit trail after the order is created**

Find the line (currently around line 602):

```typescript
    await this.cart.clear(customerId);
```

Insert immediately before it:

```typescript
    // Item 5 fase 1: fire-and-forget audit record, same pattern as every other fail-open
    // call on this path (notify, claimFavoriteDepot). The price was already locked in by
    // the quote above — this call can never change what the customer was charged.
    await this.promoAutoApply.apply(
      order.id,
      depot.id,
      'APP',
      items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
    );
```

- [ ] **Step 5: Run the order-service test suite**

```bash
cd services/order-service
npx jest
```

Expected: PASS. If any pre-existing `checkout()` test fails because it asserts an exact
`subtotal`/`shippingFee` and its test double for `this.promoAutoApply` is undefined (NestJS
unit tests in this file construct `OrderService` directly with a list of fake ports — the
constructor now requires one more), find wherever `new OrderService(...)` is called in
`test/unit/order.service.spec.ts` and add a fake implementing `PromoAutoApplyPort` that
always resolves to `{ lines: [], shippingAppliedRuleId: null, shippingFeeOverride: null }`
for `quote` and `undefined` for `apply` — this keeps every pre-existing test's pricing math
byte-for-byte unchanged (an empty quote is a true no-op through `applyPromoQuote`).

- [ ] **Step 6: Commit**

```bash
git add services/order-service/src/application/services/order.service.ts
git commit -m "feat(order): wire promo auto-apply into customer checkout"
```

---

### Task 5: Wire into `walkInSale()` (counter path)

**Files:**
- Modify: `services/order-service/src/application/services/order.service.ts`

**Interfaces:**
- Consumes: same as Task 4 (`this.promoAutoApply`, `applyPromoQuote`, already injected in
  Task 4 — this task only adds call sites).

- [ ] **Step 1: Apply the shipping override inside `counterShippingFee`**

Find `private async counterShippingFee` (currently around line 2150):

```typescript
  private async counterShippingFee(
    depotId: string,
    lines: { productId: string; quantity: number }[],
  ): Promise<number> {
    const depots = await this.depotDirectory.listActiveDepots();
    const depot = depots?.find((d) => d.id === depotId);
    if (!depot) throw new DepotUnavailableError();
    const { items } = await this.priceLines(depotId, lines);
    return money(depot.deliveryFee * galonQuantity(items));
  }
```

Replace it with:

```typescript
  private async counterShippingFee(
    depotId: string,
    lines: { productId: string; quantity: number }[],
  ): Promise<number> {
    const depots = await this.depotDirectory.listActiveDepots();
    const depot = depots?.find((d) => d.id === depotId);
    if (!depot) throw new DepotUnavailableError();
    const { items } = await this.priceLines(depotId, lines);
    // Item 5 fase 1: a SHIPPING_DISCOUNT promo replaces the depot's own per-galon fee at
    // the counter too. Only the shipping-relevant quote is needed here; `priceCounterBasket`
    // (below) runs its own quote for the item-level adjustments against its own `priceLines`
    // call — see Plan 2's Global Constraints for why this is two calls, not one.
    const autoPromoQuote = await this.promoAutoApply.quote(
      depotId,
      'COUNTER',
      items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
    );
    const perGalonFee = autoPromoQuote.shippingFeeOverride ?? depot.deliveryFee;
    return money(perGalonFee * galonQuantity(items));
  }
```

- [ ] **Step 2: Apply item-level adjustments inside `priceCounterBasket`**

Find `async priceCounterBasket` (currently around line 2161):

```typescript
  async priceCounterBasket(
    customerId: string,
    depotId: string,
    lines: { productId: string; quantity: number }[],
    voucherCodeInput?: string | null,
    shippingFee = 0,
  ): Promise<CounterBasketQuote> {
    const { items, subtotal, tierPricedTotal, tieredProductIds, catalogFallback } =
      await this.priceLines(depotId, lines);
    const voucherCode = voucherCodeInput?.trim().toUpperCase() || null;
```

Replace the first four lines of the body with:

```typescript
  async priceCounterBasket(
    customerId: string,
    depotId: string,
    lines: { productId: string; quantity: number }[],
    voucherCodeInput?: string | null,
    shippingFee = 0,
  ): Promise<CounterBasketQuote> {
    const { items: pricedItems, tierPricedTotal, tieredProductIds, catalogFallback } =
      await this.priceLines(depotId, lines);
    // Item 5 fase 1: auto-apply promo rules for the counter channel, computed BEFORE
    // membership/voucher discounting (same ordering as the app checkout path — see Plan 2's
    // Global Constraints). `channel: 'COUNTER'` is how a Senin-Optimis-style counter-only
    // rule distinguishes itself from an app order.
    const autoPromoQuote = await this.promoAutoApply.quote(
      depotId,
      'COUNTER',
      pricedItems.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
    );
    const { items, subtotal } = applyPromoQuote(pricedItems, autoPromoQuote);
    const voucherCode = voucherCodeInput?.trim().toUpperCase() || null;
```

The rest of the method (the `counterDiscount(...)` call and the returned object) is
unchanged — it already reads `items` and `subtotal` from this scope by name, which now hold
the promo-adjusted values.

- [ ] **Step 3: Record the audit trail after the order is created**

Find this line inside `walkInSale` (currently around line 1071):

```typescript
    if (catalogFallback) await this.markCatalogPricing(order, catalogFallback);
```

Insert immediately before it:

```typescript
    // Item 5 fase 1: same fire-and-forget audit record as the app checkout path.
    await this.promoAutoApply.apply(
      order.id,
      input.depotId,
      'COUNTER',
      items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })),
    );
```

- [ ] **Step 4: Run the order-service test suite**

```bash
cd services/order-service
npx jest
```

Expected: PASS. Same note as Task 4 Step 5 applies to any pre-existing `walkInSale`/
`priceCounterBasket` test that constructs `OrderService` directly.

- [ ] **Step 5: Typecheck and lint the whole service**

```bash
npx tsc --noEmit -p .
npx eslint src test --max-warnings 0
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add services/order-service/src/application/services/order.service.ts
git commit -m "feat(order): wire promo auto-apply into counter sale checkout"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** fail-open port+adapter (Task 1), free-unit merge + stock-reservation fix
  (Tasks 2-3), both real checkout paths incl. the shipping override (Tasks 4-5). The
  `apply()` audit call fires on both paths. Explicitly out of scope and stated as such:
  category-scoped matching (needs product-service plumbing) and promo-vs-voucher UI
  messaging (not asked for).
- **Placeholder scan:** one step (Task 3 Step 2) is deliberately left as a pointer into the
  live, very large pre-existing `order.service.spec.ts` rather than reproduced blind —
  flagged explicitly as the one exception, with exact instructions for what the test must
  prove, not "add appropriate tests".
- **Type consistency:** `AutoApplyCartLine`/`AutoApplyLineResult`/`AutoApplyQuoteResult`
  (Task 1) match what `applyPromoQuote`/`reservationLinesFor` (Task 2) consume and what the
  two checkout call sites (Tasks 4-5) construct, field-for-field.

## What's Next (separate plan)

- **Plan 3:** `/hq/promo-rules` and `/dashboard/promo-rules` admin UI — the only way to
  create a `PromoRule` right now is a direct `POST /promotions/promo-rules` call (curl or
  the Swagger doc); nothing in this plan or Plan 1 builds a screen for it.
