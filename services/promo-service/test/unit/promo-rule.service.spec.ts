import { randomUUID } from 'node:crypto';

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
    // Simulate the DB's unique (orderId, promoRuleId, productId) constraint for extra
    // confidence beyond the service's hasApplicationFor() pre-check: a batch that collides
    // with anything already recorded writes nothing, mirroring the Prisma repo's P2002-swallow.
    const collides = rows.some((row) =>
      this.applications.some(
        (a) =>
          a.orderId === orderId && a.promoRuleId === row.promoRuleId && a.productId === row.productId,
      ),
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
        service.update(row.id, fullPatch({ validUntil: new Date('2026-01-01') })),
      ).rejects.toThrow(PromoRuleValidationError);
    });

    // Fix 5's other confirmed bug: `patch.kind === undefined` overwrote `current.kind`
    // before the switch in `validate()` ran, so a name-only patch on a SPECIAL_PRICE rule
    // fell into the `default` branch — which happened to still pass here, but the merge
    // itself was wrong; a stricter kind (e.g. BUY_X_GET_Y, see the next test) exposes it.
    it('accepts a name-only patch on an existing SPECIAL_PRICE rule', async () => {
      const row = await service.create(baseInput());
      const updated = await service.update(row.id, fullPatch({ name: 'Baru' }));
      expect(updated.name).toBe('Baru');
    });

    it('accepts a name-only patch on an existing BUY_X_GET_Y rule (kind must survive the merge)', async () => {
      const row = await service.create(
        baseInput({ kind: 'BUY_X_GET_Y', specialPrice: null, buyQty: 2, getQty: 1 }),
      );
      const updated = await service.update(row.id, fullPatch({ name: 'Baru' }));
      expect(updated.name).toBe('Baru');
      expect(updated.kind).toBe('BUY_X_GET_Y');
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

    // I-4: PromoApplication.promoRule is onDelete: Restrict, so deleting a rule that has
    // fired at least once throws a Postgres FK violation (P2003) from the repository — the
    // service must turn that into a clean domain error, not let the raw Prisma error escape.
    it('throws PromoRuleInUseError when the repository reports a P2003 FK violation', async () => {
      const row = await service.create(baseInput());
      jest.spyOn(repo, 'delete').mockRejectedValueOnce(
        Object.assign(new Error('FK violation'), { code: 'P2003' }),
      );
      await expect(service.remove(row.id)).rejects.toThrow(PromoRuleInUseError);
    });

    it('PromoRuleInUseError carries a 409 status for the HTTP filter', async () => {
      const row = await service.create(baseInput());
      jest.spyOn(repo, 'delete').mockRejectedValueOnce(
        Object.assign(new Error('FK violation'), { code: 'P2003' }),
      );
      await expect(service.remove(row.id)).rejects.toMatchObject({
        status: 409,
        code: 'PROMO_RULE_IN_USE',
      });
    });

    it('rethrows a non-P2003 error from the repository unchanged', async () => {
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
      await service.update(row.id, { active: false });
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
});
