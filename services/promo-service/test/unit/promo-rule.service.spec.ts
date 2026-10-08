import { randomUUID } from 'node:crypto';

import { StaleWriteError } from '@hydromart/platform';

import {
  CreatePromoRuleData,
  PromoRuleRecord,
  PromoRuleRepository,
  UpdatePromoRuleData,
} from '../../src/application/ports/promo-rule.repository';
import { PromoRuleCandidate } from '../../src/domain/promo-rule';
import {
  PromoRuleService,
  PromoRuleValidationError,
} from '../../src/application/services/promo-rule.service';
import { PromoRuleInUseError, PromoRuleNotFoundError } from '../../src/domain/errors';
import { PromoConfigService } from '../../src/config/promo-config.service';

class InMemoryPromoRuleRepository implements PromoRuleRepository {
  rows: PromoRuleRecord[] = [];
  applications: {
    orderId: string;
    promoRuleId: string;
    productId: string | null;
    discountValue: number;
  }[] = [];

  async findById(id: string): Promise<PromoRuleRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(data: CreatePromoRuleData): Promise<PromoRuleRecord> {
    const now = new Date();
    const row: PromoRuleRecord = { id: randomUUID(), active: true, createdAt: now, updatedAt: now, ...data };
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: UpdatePromoRuleData): Promise<PromoRuleRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    // Mirror Prisma's own `update`: a key with value `undefined` is left untouched, never
    // written as null. The controller always sends every DTO key, undefined for whatever
    // the caller omitted — real Prisma already ignores those; this fake must too, or tests
    // that build a full patch object (see Fix 5's tests) would wipe fields they never meant
    // to touch.
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = value;
    }
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async findAll(): Promise<PromoRuleRecord[]> {
    return this.rows;
  }
  async findActiveCandidates(): Promise<PromoRuleCandidate[]> {
    return this.rows.filter((r) => r.active);
  }
  async recordApplications(
    orderId: string,
    rows: { promoRuleId: string; productId: string | null; discountValue: number }[],
  ): Promise<void> {
    // Simulate BOTH real unique indexes for extra confidence beyond the service's
    // hasApplicationFor() pre-check: a batch that collides with anything already recorded
    // writes nothing, mirroring the Prisma repo's P2002-swallow.
    //  - base @@unique(orderId, promoRuleId, productId): Postgres treats every NULL as
    //    DISTINCT from every other NULL, so on its own this one never fires when productId
    //    is null on either side — only an exact non-null match collides.
    //  - partial index on (orderId, promoRuleId) WHERE productId IS NULL (migration
    //    20261004080000): added specifically because the base index above does NOT stop two
    //    null-productId (shipping-discount) rows for the same order+rule from colliding.
    const collides = rows.some((row) =>
      this.applications.some((a) => {
        if (a.orderId !== orderId || a.promoRuleId !== row.promoRuleId) return false;
        // Both sides null: only the partial index protects this — a base-check-alone
        // comparison (a.productId === row.productId) would wrongly say "distinct" per real
        // Postgres NULL semantics, but the partial index still makes it a real collision.
        if (a.productId === null || row.productId === null) {
          return a.productId === null && row.productId === null;
        }
        return a.productId === row.productId;
      }),
    );
    if (collides) return;
    for (const row of rows) this.applications.push({ orderId, ...row });
  }
  async hasApplicationFor(orderId: string): Promise<boolean> {
    return this.applications.some((a) => a.orderId === orderId);
  }
}

const baseInput = (overrides: Partial<CreatePromoRuleData> = {}): CreatePromoRuleData => ({
  name: 'Jumat Berkah',
  kind: 'SPECIAL_PRICE',
  depotId: null,
  productId: null,
  categoryId: null,
  specialPrice: 6000,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  percentOff: null,
  minSubtotal: null,
  discountAmount: null,
  giftProductId: null,
  firstOrderOnly: false,
  validFrom: null,
  validUntil: null,
  daysOfWeek: [5],
  startTime: null,
  endTime: null,
  minQty: 1,
  maxQty: null,
  channels: [],
  ...overrides,
});

const fakeConfig = { businessTimeZone: 'Asia/Jakarta' } as unknown as PromoConfigService;

describe('PromoRuleService', () => {
  let repo: InMemoryPromoRuleRepository;
  let service: PromoRuleService;

  beforeEach(() => {
    repo = new InMemoryPromoRuleRepository();
    service = new PromoRuleService(repo, fakeConfig);
  });

  describe('create validation', () => {
    it('creates a valid SPECIAL_PRICE rule', async () => {
      const row = await service.create(baseInput());
      expect(row.specialPrice).toBe(6000);
    });

    it('rejects SPECIAL_PRICE with no specialPrice', async () => {
      await expect(
        service.create(baseInput({ specialPrice: null })),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    it('rejects BUY_X_GET_Y with no buyQty/getQty', async () => {
      await expect(
        service.create(baseInput({ kind: 'BUY_X_GET_Y', specialPrice: null, buyQty: null, getQty: null })),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    it('rejects SHIPPING_DISCOUNT with no shippingFeeOverride', async () => {
      await expect(
        service.create(
          baseInput({ kind: 'SHIPPING_DISCOUNT', specialPrice: null, shippingFeeOverride: null }),
        ),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    // I-3: PromoRuleValidationError used to extend plain Error, so every validation failure
    // hit AllExceptionsFilter's generic masked-500 path. It now extends DomainError with its
    // own status/code — the filter (tested generically in packages/platform) reads those
    // fields directly, so asserting them here is what proves this throws a 400, not a 500.
    it('PromoRuleValidationError carries a 400 status and a stable code for the HTTP filter', async () => {
      await expect(service.create(baseInput({ specialPrice: null }))).rejects.toMatchObject({
        status: 400,
        code: 'PROMO_RULE_VALIDATION',
      });
    });

    // I-5: evaluateShipping always matches against a synthetic line with quantity: 1, so a
    // SHIPPING_DISCOUNT rule with minQty > 1 could never fire — reject it at create time
    // instead of letting it silently never apply.
    it('rejects SHIPPING_DISCOUNT with minQty > 1', async () => {
      await expect(
        service.create(
          baseInput({
            kind: 'SHIPPING_DISCOUNT',
            specialPrice: null,
            shippingFeeOverride: 1000,
            minQty: 5,
          }),
        ),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    it('rejects SHIPPING_DISCOUNT with a maxQty set', async () => {
      await expect(
        service.create(
          baseInput({
            kind: 'SHIPPING_DISCOUNT',
            specialPrice: null,
            shippingFeeOverride: 1000,
            minQty: 1,
            maxQty: 10,
          }),
        ),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    // D-2 (same defect class as I-5): evaluateShipping's synthetic line has productId: ''
    // and categoryId: null, so a rule scoped to a product or category could never match it —
    // reject at create time instead of letting it silently never apply.
    it('rejects SHIPPING_DISCOUNT with a productId set', async () => {
      await expect(
        service.create(
          baseInput({
            kind: 'SHIPPING_DISCOUNT',
            specialPrice: null,
            shippingFeeOverride: 1000,
            productId: 'p1',
          }),
        ),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    it('rejects SHIPPING_DISCOUNT with a categoryId set', async () => {
      await expect(
        service.create(
          baseInput({
            kind: 'SHIPPING_DISCOUNT',
            specialPrice: null,
            shippingFeeOverride: 1000,
            categoryId: 'c1',
          }),
        ),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    it('accepts SHIPPING_DISCOUNT with default minQty (1) and no maxQty', async () => {
      const row = await service.create(
        baseInput({ kind: 'SHIPPING_DISCOUNT', specialPrice: null, shippingFeeOverride: 1000 }),
      );
      expect(row.shippingFeeOverride).toBe(1000);
    });

    // Fix 1: this repo has no overnight-window support — a rule with startTime >= endTime
    // would silently never match (hhmm can never be both >= startTime and <= endTime across
    // midnight), so reject it at creation instead of shipping a dead rule.
    it('rejects a startTime that is not before endTime', async () => {
      await expect(
        service.create(baseInput({ startTime: '18:00', endTime: '09:00' })),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    // Fix 1's sibling: minQty > maxQty makes the quantity window impossible to satisfy.
    it('rejects a minQty greater than maxQty', async () => {
      await expect(
        service.create(baseInput({ minQty: 10, maxQty: 5 })),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    it('rejects validFrom after validUntil', async () => {
      await expect(
        service.create(
          baseInput({
            validFrom: new Date('2026-12-31'),
            validUntil: new Date('2026-01-01'),
          }),
        ),
      ).rejects.toThrow(PromoRuleValidationError);
    });
  });

  describe('update', () => {
    // The controller always builds its patch object with EVERY DTO key present — `undefined`
    // for whatever the caller omitted from the PATCH body (see `PromoRuleController.update`).
    // Mirror that shape here rather than a sparse literal, or the old bug (fixed by Fix 5)
    // would not actually be exercised: a sparse `{ validUntil: ... }` has no `validFrom` key
    // at all, so even the buggy `{ ...current, ...patch }` spread would have left it alone.
    const fullPatch = (overrides: Partial<UpdatePromoRuleData> = {}): UpdatePromoRuleData => ({
      name: undefined,
      kind: undefined,
      depotId: undefined,
      productId: undefined,
      categoryId: undefined,
      specialPrice: undefined,
      buyQty: undefined,
      getQty: undefined,
      shippingFeeOverride: undefined,
      validFrom: undefined,
      validUntil: undefined,
      daysOfWeek: undefined,
      startTime: undefined,
      endTime: undefined,
      minQty: undefined,
      maxQty: undefined,
      channels: undefined,
      active: undefined,
      ...overrides,
    });

    // Fix 5: `update` used to validate `{ ...current, ...patch }`, so this undefined-key
    // merge wiped out the stored `validFrom` BEFORE the validFrom>validUntil check ran,
    // wrongly ACCEPTING a validUntil that precedes the rule's real validFrom.
    it('rejects a validUntil-only patch that would precede the stored validFrom', async () => {
      const row = await service.create(
        baseInput({ validFrom: new Date('2026-06-01'), validUntil: null, daysOfWeek: [] }),
      );
      await expect(
        service.update(
          row.id,
          fullPatch({ validUntil: new Date('2026-01-01') }),
          row.updatedAt.toISOString(),
        ),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    // Fix 5's other confirmed bug: `patch.kind === undefined` overwrote `current.kind`
    // before the switch in `validate()` ran, so a name-only patch on a SPECIAL_PRICE rule
    // fell into the `default` branch — which happened to still pass here, but the merge
    // itself was wrong; a stricter kind (e.g. BUY_X_GET_Y, see the next test) exposes it.
    it('accepts a name-only patch on an existing SPECIAL_PRICE rule', async () => {
      const row = await service.create(baseInput());
      const updated = await service.update(
        row.id,
        fullPatch({ name: 'Baru' }),
        row.updatedAt.toISOString(),
      );
      expect(updated.name).toBe('Baru');
    });

    it('accepts a name-only patch on an existing BUY_X_GET_Y rule (kind must survive the merge)', async () => {
      const row = await service.create(
        baseInput({ kind: 'BUY_X_GET_Y', specialPrice: null, buyQty: 2, getQty: 1 }),
      );
      const updated = await service.update(
        row.id,
        fullPatch({ name: 'Baru' }),
        row.updatedAt.toISOString(),
      );
      expect(updated.name).toBe('Baru');
      expect(updated.kind).toBe('BUY_X_GET_Y');
    });

    // CA-2-53: the write is refused when the caller's copy is older than the stored rule.
    it('rejects an update whose seenUpdatedAt is stale', async () => {
      const row = await service.create(baseInput());
      await expect(
        service.update(row.id, fullPatch({ name: 'Baru' }), new Date(0).toISOString()),
      ).rejects.toThrow(StaleWriteError);
    });

    // A current seenUpdatedAt (the exact value the record carries right now) must still go
    // through — the guard exists to catch a STALE copy, not to demand a stamp that happens
    // to equal nothing meaningful.
    it('accepts an update whose seenUpdatedAt matches the stored row exactly', async () => {
      const row = await service.create(baseInput());
      const updated = await service.update(
        row.id,
        fullPatch({ name: 'Baru' }),
        row.updatedAt.toISOString(),
      );
      expect(updated.name).toBe('Baru');
    });
  });

  describe('findAll', () => {
    it('delegates to the repository', async () => {
      const row = await service.create(baseInput());
      expect(await service.findAll()).toEqual([row]);
    });
  });

  describe('remove', () => {
    it('deletes an existing rule', async () => {
      const row = await service.create(baseInput());
      await service.remove(row.id);
      expect(await service.findAll()).toEqual([]);
    });

    it('throws PromoRuleNotFoundError when removing an unknown id', async () => {
      await expect(service.remove('missing')).rejects.toThrow(PromoRuleNotFoundError);
    });

    // Fix 5: the P2003→PromoRuleInUseError translation now lives in the repository (see
    // prisma-repositories.spec.ts), same discipline as recordApplications' P2002 handling.
    // remove() is a plain pass-through now — this proves it doesn't swallow or rewrap
    // whatever the repository already decided to throw.
    it('propagates a PromoRuleInUseError the repository already translated, unchanged', async () => {
      const row = await service.create(baseInput());
      jest.spyOn(repo, 'delete').mockRejectedValueOnce(new PromoRuleInUseError());
      await expect(service.remove(row.id)).rejects.toMatchObject({
        status: 409,
        code: 'PROMO_RULE_IN_USE',
      });
    });

    it('propagates any other repository error unchanged', async () => {
      const row = await service.create(baseInput());
      const boom = new Error('boom');
      jest.spyOn(repo, 'delete').mockRejectedValueOnce(boom);
      await expect(service.remove(row.id)).rejects.toBe(boom);
    });
  });

  describe('findById', () => {
    it('throws PromoRuleNotFoundError for an unknown id', async () => {
      await expect(service.findById('missing')).rejects.toThrow(PromoRuleNotFoundError);
    });
  });

  describe('quote', () => {
    it('returns an unmodified line when no rule matches', async () => {
      const result = await service.quote({
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'), // Friday
        lines: [{ productId: 'p1', categoryId: null, quantity: 1, unitPrice: 8000 }],
      });
      expect(result.lines).toEqual([
        { productId: 'p1', appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0, lineTotal: 8000 },
      ]);
      expect(result.shipping).toEqual({ appliedRuleId: null, shippingFeeOverride: null });
    });

    it('applies a matching active rule', async () => {
      await service.create(baseInput());
      const result = await service.quote({
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'), // Friday 10:00 WIB
        lines: [{ productId: 'p1', categoryId: null, quantity: 1, unitPrice: 8000 }],
      });
      expect(result.lines[0].unitPriceAfter).toBe(6000);
    });

    it('ignores an inactive rule', async () => {
      const row = await service.create(baseInput());
      await service.update(row.id, { active: false }, row.updatedAt.toISOString());
      const result = await service.quote({
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'),
        lines: [{ productId: 'p1', categoryId: null, quantity: 1, unitPrice: 8000 }],
      });
      expect(result.lines[0].unitPriceAfter).toBe(8000);
    });

    // Fix 3: a depot-scoped rule must never leak into a network-wide (no-depot) quote — it
    // used to, because `undefined` candidate filtering meant "every depot" rather than
    // "no depot".
    it('does not apply a depot-scoped rule to a network-wide (depotId null) quote', async () => {
      await service.create(baseInput({ depotId: 'depot-a' }));
      const result = await service.quote({
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'),
        lines: [{ productId: 'p1', categoryId: null, quantity: 1, unitPrice: 8000 }],
      });
      expect(result.lines[0].unitPriceAfter).toBe(8000);
      expect(result.lines[0].appliedRuleIds).toEqual([]);
    });
  });

  describe('apply', () => {
    // apply() trusts a quote() result the caller already computed — it no longer re-matches
    // anything. These tests build `quotedLines`/`quotedShipping` by hand to represent "what a
    // prior quote() call already returned", exactly as order-service (Plan 2) will do.

    it('records one row for a SPECIAL_PRICE-only win', async () => {
      await service.apply({
        orderId: 'order-1',
        originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 2 }],
        quotedLines: [
          {
            productId: 'p1',
            appliedRuleIds: ['rule-special'],
            unitPriceAfter: 6000,
            freeQty: 0,
            lineTotal: 12000,
          },
        ],
        quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
      });
      expect(repo.applications).toEqual([
        { orderId: 'order-1', promoRuleId: 'rule-special', productId: 'p1', discountValue: 4000 },
      ]);
    });

    // The specific bug the plan calls out: destructuring appliedRuleIds as [specialId, bogoId]
    // would misattribute a pure-BOGO win to a nonexistent special-price id, because when only
    // BOGO wins, appliedRuleIds[0] IS the BOGO id.
    it('records one row for a BOGO-only win, attributed to the BOGO rule id (not misattributed)', async () => {
      await service.apply({
        orderId: 'order-2',
        originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 3 }],
        quotedLines: [
          {
            productId: 'p1',
            appliedRuleIds: ['rule-bogo'],
            unitPriceAfter: 8000, // unchanged: no SPECIAL_PRICE won
            freeQty: 3,
            lineTotal: 24000,
          },
        ],
        quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
      });
      expect(repo.applications).toEqual([
        {
          orderId: 'order-2',
          promoRuleId: 'rule-bogo',
          productId: 'p1',
          discountValue: 24000, // 3 free * 8000 (line's price, unchanged here)
        },
      ]);
    });

    it('records two rows when SPECIAL_PRICE and BUY_X_GET_Y stack on one line', async () => {
      await service.apply({
        orderId: 'order-3',
        originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 2 }],
        quotedLines: [
          {
            productId: 'p1',
            appliedRuleIds: ['rule-special', 'rule-bogo'],
            unitPriceAfter: 7000,
            freeQty: 2,
            lineTotal: 14000,
          },
        ],
        quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
      });
      expect(repo.applications).toEqual([
        { orderId: 'order-3', promoRuleId: 'rule-special', productId: 'p1', discountValue: 2000 }, // (8000-7000)*2
        { orderId: 'order-3', promoRuleId: 'rule-bogo', productId: 'p1', discountValue: 14000 }, // 2 free * 7000
      ]);
    });

    // Fix 7: a caller claiming appliedRuleIds that don't agree with what priceWon/bogoWon
    // actually say happened is inconsistent data — reject loudly rather than silently losing
    // or inventing audit rows.
    it('rejects a line whose appliedRuleIds count disagrees with priceWon/bogoWon', async () => {
      await expect(
        service.apply({
          orderId: 'order-mismatch',
          originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 1 }],
          quotedLines: [
            {
              productId: 'p1',
              // unitPriceAfter unchanged (no price win) and freeQty 0 (no BOGO win) means
              // expectedRows is 0, but the caller claims one id anyway.
              appliedRuleIds: ['rule-ghost'],
              unitPriceAfter: 8000,
              freeQty: 0,
              lineTotal: 8000,
            },
          ],
          quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
        }),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    it('writes no row for a line where nothing won', async () => {
      await service.apply({
        orderId: 'order-4',
        originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 1 }],
        quotedLines: [
          { productId: 'p1', appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0, lineTotal: 8000 },
        ],
        quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
      });
      expect(repo.applications).toHaveLength(0);
    });

    it('computes the shipping discount as originalShippingFee - shippingFeeOverride', async () => {
      await service.apply({
        orderId: 'order-5',
        originalLines: [],
        quotedLines: [],
        quotedShipping: { appliedRuleId: 'rule-ship', shippingFeeOverride: 1000 },
        originalShippingFee: 2000,
        shippingUnits: 1,
      });
      expect(repo.applications).toEqual([
        { orderId: 'order-5', promoRuleId: 'rule-ship', productId: null, discountValue: 1000 },
      ]);
    });

    // C-1: shippingFeeOverride/originalShippingFee are PER-GALON values, and delivery fee is
    // charged per-galon (deliveryFee × quantity) — so the real discount must be multiplied by
    // the unit count, not just the raw per-unit difference.
    it('multiplies the shipping discount by shippingUnits (per-galon fee, 5 galons)', async () => {
      await service.apply({
        orderId: 'order-5b',
        originalLines: [],
        quotedLines: [],
        quotedShipping: { appliedRuleId: 'rule-ship', shippingFeeOverride: 1000 },
        originalShippingFee: 2000,
        shippingUnits: 5,
      });
      expect(repo.applications).toEqual([
        { orderId: 'order-5b', promoRuleId: 'rule-ship', productId: null, discountValue: 5000 },
      ]);
    });

    // D-1: shippingUnits has no safe default. The DTO requires it whenever
    // originalShippingFee is sent (see controller spec), but a direct service-level caller
    // that skips DTO validation and sends originalShippingFee without shippingUnits must not
    // get a silently-guessed discount — the shipping row is skipped entirely instead.
    it('writes no shipping row when originalShippingFee is set but shippingUnits is missing', async () => {
      await service.apply({
        orderId: 'order-5c',
        originalLines: [],
        quotedLines: [],
        quotedShipping: { appliedRuleId: 'rule-ship', shippingFeeOverride: 1000 },
        originalShippingFee: 2000,
        // shippingUnits intentionally omitted
      });
      expect(repo.applications).toHaveLength(0);
    });

    // shippingUnits: 0 is legitimate (e.g. a shipping-only order with no galon lines) and
    // must record a real discountValue of 0, not be treated as "missing" or an error.
    it('accepts shippingUnits: 0 and records a zero discount', async () => {
      await service.apply({
        orderId: 'order-5e',
        originalLines: [],
        quotedLines: [],
        quotedShipping: { appliedRuleId: 'rule-ship', shippingFeeOverride: 1000 },
        originalShippingFee: 2000,
        shippingUnits: 0,
      });
      expect(repo.applications).toEqual([
        { orderId: 'order-5e', promoRuleId: 'rule-ship', productId: null, discountValue: 0 },
      ]);
    });

    // I-2: the shipping sibling of the SPECIAL_PRICE price-raise guard — if the "override"
    // actually raised the fee above the original, this is not a discount at all; never write
    // a negative discountValue.
    it('skips the shipping row when the override raised the fee above the original', async () => {
      await service.apply({
        orderId: 'order-5d',
        originalLines: [],
        quotedLines: [],
        quotedShipping: { appliedRuleId: 'rule-ship', shippingFeeOverride: 3000 },
        originalShippingFee: 2000,
        shippingUnits: 1,
      });
      expect(repo.applications).toHaveLength(0);
    });

    // I-1a: a caller bug that produces two cart lines winning the same rule for the same
    // product must not crash createMany with an in-batch P2002 — merge into one row with the
    // summed discountValue instead.
    it('merges two lines that win the same rule for the same product into one summed row', async () => {
      await service.apply({
        orderId: 'order-9',
        originalLines: [
          { productId: 'p1', unitPrice: 8000, quantity: 1 },
          { productId: 'p1', unitPrice: 8000, quantity: 1 },
        ],
        quotedLines: [
          { productId: 'p1', appliedRuleIds: ['rule-special'], unitPriceAfter: 6000, freeQty: 0, lineTotal: 6000 },
          { productId: 'p1', appliedRuleIds: ['rule-special'], unitPriceAfter: 6000, freeQty: 0, lineTotal: 6000 },
        ],
        quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
      });
      expect(repo.applications).toEqual([
        { orderId: 'order-9', promoRuleId: 'rule-special', productId: 'p1', discountValue: 4000 },
      ]);
    });

    it('writes no shipping row when shipping won but originalShippingFee was omitted', async () => {
      await service.apply({
        orderId: 'order-6',
        originalLines: [],
        quotedLines: [],
        quotedShipping: { appliedRuleId: 'rule-ship', shippingFeeOverride: 1000 },
        // originalShippingFee omitted
      });
      expect(repo.applications).toHaveLength(0);
    });

    it('is idempotent: calling apply twice for the same orderId records once', async () => {
      const callApply = () =>
        service.apply({
          orderId: 'order-7',
          originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 1 }],
          quotedLines: [
            {
              productId: 'p1',
              appliedRuleIds: ['rule-special'],
              unitPriceAfter: 6000,
              freeQty: 0,
              lineTotal: 6000,
            },
          ],
          quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
        });
      await callApply();
      await callApply();
      expect(repo.applications.filter((a) => a.orderId === 'order-7')).toHaveLength(1);
    });

    // Fix 9: apply() trusts quote()'s own return shape as its input (see ApplyInput's
    // doc-comments: quotedLines IS LineResult[], quotedShipping IS ShippingResult) — prove
    // the two compose end to end, feeding quote()'s real output into apply() rather than a
    // hand-built fixture that could drift from what quote() actually returns.
    it('round-trips: apply() accepts quote()\'s own return value unchanged', async () => {
      const row = await service.create(baseInput());
      const cartLines = [{ productId: 'p1', categoryId: null, quantity: 2, unitPrice: 8000 }];
      const quoted = await service.quote({
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'), // Friday
        lines: cartLines,
      });
      expect(quoted.lines[0].appliedRuleIds).toEqual([row.id]);

      await service.apply({
        orderId: 'order-roundtrip',
        originalLines: cartLines.map((l) => ({
          productId: l.productId,
          unitPrice: l.unitPrice,
          quantity: l.quantity,
        })),
        quotedLines: quoted.lines,
        quotedShipping: quoted.shipping,
      });

      expect(repo.applications).toEqual([
        {
          orderId: 'order-roundtrip',
          promoRuleId: row.id,
          productId: 'p1',
          discountValue: 4000, // (8000-6000) * 2
        },
      ]);
    });

    it('writes nothing when quotedLines and quotedShipping both carry no winner', async () => {
      await service.apply({
        orderId: 'order-8',
        originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 1 }],
        quotedLines: [
          { productId: 'p1', appliedRuleIds: [], unitPriceAfter: 8000, freeQty: 0, lineTotal: 8000 },
        ],
        quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
      });
      expect(repo.applications).toHaveLength(0);
    });
  });

  describe('item 5 kinds · validation', () => {
    const reject = (overrides: Parameters<typeof baseInput>[0]) =>
      expect(service.create(baseInput({ specialPrice: null, ...overrides }))).rejects.toThrow(
        PromoRuleValidationError,
      );

    it('PERCENTAGE_OFF needs a percent in 1..99', async () => {
      await reject({ kind: 'PERCENTAGE_OFF' });
      await reject({ kind: 'PERCENTAGE_OFF', percentOff: 0 });
      await reject({ kind: 'PERCENTAGE_OFF', percentOff: 100 });
      await expect(service.create(baseInput({ kind: 'PERCENTAGE_OFF', specialPrice: null, percentOff: 15 }))).resolves.toBeDefined();
    });

    it('ORDER_DISCOUNT needs a minimum and exactly one of amount / percent', async () => {
      await reject({ kind: 'ORDER_DISCOUNT', discountAmount: 10000 }); // no minSubtotal
      await reject({ kind: 'ORDER_DISCOUNT', minSubtotal: 100000 }); // neither
      await reject({ kind: 'ORDER_DISCOUNT', minSubtotal: 100000, discountAmount: 10000, percentOff: 5 }); // both
      await reject({ kind: 'ORDER_DISCOUNT', minSubtotal: 100000, discountAmount: 0 });
      await reject({ kind: 'ORDER_DISCOUNT', minSubtotal: 100000, percentOff: 100 });
      await expect(
        service.create(baseInput({ kind: 'ORDER_DISCOUNT', specialPrice: null, minSubtotal: 100000, discountAmount: 10000 })),
      ).resolves.toBeDefined();
      await expect(
        service.create(baseInput({ kind: 'ORDER_DISCOUNT', specialPrice: null, minSubtotal: 0, percentOff: 5 })),
      ).resolves.toBeDefined();
    });

    it('ORDER_DISCOUNT is order-level: no product, category or quantity limits (they could never match)', async () => {
      const ok = { kind: 'ORDER_DISCOUNT' as const, minSubtotal: 1, discountAmount: 1000 };
      await reject({ ...ok, productId: 'p1' });
      await reject({ ...ok, categoryId: 'c1' });
      await reject({ ...ok, minQty: 2 });
      await reject({ ...ok, maxQty: 9 });
    });

    it('BUNDLE_GIFT needs buy, get and a gift product that is not the bought one', async () => {
      const ok = { kind: 'BUNDLE_GIFT' as const, buyQty: 2, getQty: 1, giftProductId: 'gift' };
      await reject({ ...ok, buyQty: null });
      await reject({ ...ok, getQty: null });
      await reject({ ...ok, giftProductId: null });
      await reject({ ...ok, productId: 'gift' });
      await expect(service.create(baseInput({ ...ok, specialPrice: null, productId: 'p1' }))).resolves.toBeDefined();
    });

    it('a patch that switches kind is judged against the merged row', async () => {
      const row = await service.create(baseInput());
      await expect(
        service.update(row.id, { kind: 'PERCENTAGE_OFF', specialPrice: null }, row.updatedAt.toISOString()),
      ).rejects.toThrow(PromoRuleValidationError);
    });
  });

  describe('item 5 kinds · quote', () => {
    const FRI = new Date('2026-10-02T03:00:00.000Z');
    const quote = (over: Partial<Parameters<PromoRuleService['quote']>[0]> = {}) =>
      service.quote({
        depotId: null,
        channel: 'APP',
        occurredAt: FRI,
        lines: [{ productId: 'p1', categoryId: null, quantity: 2, unitPrice: 50000 }],
        ...over,
      });

    it('judges ORDER_DISCOUNT on the subtotal AFTER item promos', async () => {
      await service.create(baseInput({ kind: 'PERCENTAGE_OFF', specialPrice: null, percentOff: 20, daysOfWeek: [] }));
      await service.create(
        baseInput({ kind: 'ORDER_DISCOUNT', specialPrice: null, minSubtotal: 90000, discountAmount: 5000, daysOfWeek: [] }),
      );
      // 2 x 50000 = 100000 before, 2 x 40000 = 80000 after the 20%: below the 90000 minimum.
      expect((await quote()).orderDiscount).toEqual({ appliedRuleId: null, amount: 0 });
      // Three units: 120000 after the 20%, which clears it.
      const three = await quote({ lines: [{ productId: 'p1', categoryId: null, quantity: 3, unitPrice: 50000 }] });
      expect(three.orderDiscount.amount).toBe(5000);
    });

    it('counts a wholesale (skipPromo) line at its own price in the order subtotal, with no promo on it', async () => {
      await service.create(baseInput({ kind: 'PERCENTAGE_OFF', specialPrice: null, percentOff: 50, daysOfWeek: [] }));
      await service.create(
        baseInput({ kind: 'ORDER_DISCOUNT', specialPrice: null, minSubtotal: 100000, discountAmount: 5000, daysOfWeek: [] }),
      );
      const r = await quote({
        lines: [{ productId: 'p1', categoryId: null, quantity: 2, unitPrice: 50000, skipPromo: true }],
      });
      expect(r.lines[0]).toMatchObject({ unitPriceAfter: 50000, appliedRuleIds: [] });
      expect(r.orderDiscount.amount).toBe(5000); // 100000 reached only because the line was NOT halved
    });

    it('honours firstOrder for a first-order-only rule', async () => {
      await service.create(baseInput({ firstOrderOnly: true, daysOfWeek: [] }));
      expect((await quote()).lines[0].unitPriceAfter).toBe(50000);
      expect((await quote({ firstOrder: true })).lines[0].unitPriceAfter).toBe(6000);
    });

    it('returns the gifts a BUNDLE_GIFT earns', async () => {
      await service.create(
        baseInput({ kind: 'BUNDLE_GIFT', specialPrice: null, buyQty: 2, getQty: 1, giftProductId: 'gift', daysOfWeek: [] }),
      );
      const r = await quote({ lines: [{ productId: 'p1', categoryId: null, quantity: 5, unitPrice: 50000 }] });
      expect(r.gifts).toMatchObject([{ productId: 'gift', quantity: 2, triggerProductId: 'p1' }]);
    });
  });

  describe('item 5 kinds · apply audit', () => {
    const noLines = { orderId: 'order-9', originalLines: [], quotedLines: [], quotedShipping: { appliedRuleId: null, shippingFeeOverride: null } };

    it('records the order discount as one row with no product', async () => {
      await service.apply({ ...noLines, orderDiscount: { appliedRuleId: 'rule-order', amount: 10000 } });
      expect(repo.applications).toEqual([
        { orderId: 'order-9', promoRuleId: 'rule-order', productId: null, discountValue: 10000 },
      ]);
    });

    it('records one row per gift product, valued as the caller says', async () => {
      await service.apply({
        ...noLines,
        gifts: [
          { promoRuleId: 'rule-gift', productId: 'g1', value: 16000 },
          { promoRuleId: 'rule-gift', productId: 'g2', value: 0 },
        ],
      });
      expect(repo.applications).toEqual([
        { orderId: 'order-9', promoRuleId: 'rule-gift', productId: 'g1', discountValue: 16000 },
      ]);
    });

    it('records nothing for a zero or absent order discount', async () => {
      await service.apply({ ...noLines, orderDiscount: { appliedRuleId: 'rule-order', amount: 0 } });
      await service.apply({ ...noLines, orderId: 'order-10', orderDiscount: { appliedRuleId: null, amount: 5 } });
      expect(repo.applications).toEqual([]);
    });
  });
});
