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
import { PromoRuleNotFoundError } from '../../src/domain/errors';
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
  async recordApplication(data: {
    orderId: string;
    promoRuleId: string;
    productId: string | null;
    discountValue: number;
  }): Promise<void> {
    this.applications.push(data);
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
    it('records one PromoApplication per winning line and the shipping winner', async () => {
      await service.create(baseInput());
      await service.apply({
        orderId: 'order-1',
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'),
        lines: [{ productId: 'p1', categoryId: null, quantity: 2, unitPrice: 8000 }],
      });
      expect(repo.applications).toHaveLength(1);
      expect(repo.applications[0]).toMatchObject({
        orderId: 'order-1',
        productId: 'p1',
        discountValue: 4000, // (8000-6000) * 2
      });
    });

    it('records a PromoApplication for the winning shipping rule too', async () => {
      await service.create(
        baseInput({
          kind: 'SHIPPING_DISCOUNT',
          specialPrice: null,
          shippingFeeOverride: 1500,
          daysOfWeek: [5],
        }),
      );
      await service.apply({
        orderId: 'order-ship',
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'),
        lines: [{ productId: 'p1', categoryId: null, quantity: 1, unitPrice: 8000 }],
      });
      expect(repo.applications).toHaveLength(1);
      expect(repo.applications[0]).toMatchObject({
        orderId: 'order-ship',
        productId: null,
        discountValue: 1500,
      });
    });

    it('is idempotent: calling apply twice for the same orderId records once', async () => {
      await service.create(baseInput());
      const callApply = () =>
        service.apply({
          orderId: 'order-1',
          depotId: null,
          channel: 'APP',
          occurredAt: new Date('2026-10-02T03:00:00.000Z'),
          lines: [{ productId: 'p1', categoryId: null, quantity: 1, unitPrice: 8000 }],
        });
      await callApply();
      await callApply();
      expect(repo.applications.filter((a) => a.orderId === 'order-1')).toHaveLength(1);
    });

    it('writes nothing when no rule matched', async () => {
      await service.apply({
        orderId: 'order-2',
        depotId: null,
        channel: 'APP',
        occurredAt: new Date('2026-10-02T03:00:00.000Z'),
        lines: [{ productId: 'p1', categoryId: null, quantity: 1, unitPrice: 8000 }],
      });
      expect(repo.applications).toHaveLength(0);
    });
  });
});
