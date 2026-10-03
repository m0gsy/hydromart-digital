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
    Object.assign(row, data);
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

describe('PromoRuleService', () => {
  let repo: InMemoryPromoRuleRepository;
  let service: PromoRuleService;

  beforeEach(() => {
    repo = new InMemoryPromoRuleRepository();
    service = new PromoRuleService(repo);
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
