import { randomUUID } from 'node:crypto';

import {
  CreatePromotionData,
  PromotionRecord,
  PromotionRepository,
  UpdatePromotionData,
} from '../../src/application/ports/promotion.repository';
import { isPromotionLiveAt } from '../../src/domain/promotion';
import { PromotionService } from '../../src/application/services/promotion.service';
import { InMemoryVoucherRepository } from '../support/fakes';

// Minimal in-memory repo whose findActive reuses the pure domain predicate, so
// the date-window filter is exercised through the service exactly as in prod.
class InMemoryPromotionRepository implements PromotionRepository {
  rows: PromotionRecord[] = [];

  async findById(id: string): Promise<PromotionRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(data: CreatePromotionData): Promise<PromotionRecord> {
    const now = new Date();
    const row: PromotionRecord = {
      id: randomUUID(),
      active: true,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.rows.push(row);
    return row;
  }
  async update(id: string, data: UpdatePromotionData): Promise<PromotionRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, data);
    return row;
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id);
  }
  async findAll(): Promise<PromotionRecord[]> {
    return [...this.rows].sort(
      (a, b) => a.sortOrder - b.sortOrder || b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }
  async findActive(now: Date): Promise<PromotionRecord[]> {
    return (await this.findAll()).filter((r) => isPromotionLiveAt(r, now));
  }
}

const base = (overrides: Partial<CreatePromotionData> = {}): CreatePromotionData => ({
  title: 'Promo',
  subtitle: null,
  imageUrl: null,
  ctaLabel: null,
  ctaHref: null,
  voucherCode: null,
  sortOrder: 0,
  startsAt: null,
  endsAt: null,
  ...overrides,
});

describe('PromotionService date-window filter', () => {
  let repo: InMemoryPromotionRepository;
  let service: PromotionService;

  beforeEach(() => {
    repo = new InMemoryPromotionRepository();
    service = new PromotionService(repo, new InMemoryVoucherRepository(), new FakeOrderValues());
  });

  it('excludes a promotion whose endsAt is in the past', async () => {
    await service.create(base({ title: 'Expired', endsAt: new Date('2000-01-01T00:00:00.000Z') }));
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).not.toContain('Expired');
  });

  it('includes a promotion with startsAt null and endsAt in the future', async () => {
    await service.create(base({ title: 'Live', endsAt: new Date('2099-01-01T00:00:00.000Z') }));
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).toContain('Live');
  });

  it('excludes an inactive promotion even inside its window', async () => {
    const created = await service.create(base({ title: 'Hidden' }));
    await service.update(created.id, { active: false });
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).not.toContain('Hidden');
  });

  it('excludes a promotion that has not started yet', async () => {
    await service.create(base({ title: 'Scheduled', startsAt: new Date('2099-01-01T00:00:00.000Z') }));
    const active = await service.listActive(new Date('2026-07-12T00:00:00.000Z'));
    expect(active.map((p) => p.title)).not.toContain('Scheduled');
  });
});

interface AnalyticsView {
  promotionId: string;
  title: string;
  voucherCode: string | null;
  totalUses: number;
  usesLast7Days: number;
  totalSavingsIdr: number;
  affectedOrderIds: string[];
  affectedOrderCount: number;
  grossAffectedOrderValueIdr: number | null;
  dailyUses: { day: string; uses: number }[];
  topCustomers: { customerId: string; uses: number; savingsIdr: number }[];
  orderValueSource: 'ok' | 'unavailable' | 'not_applicable';
}

interface AnalyticsService {
  analytics(id: string, now?: Date): Promise<AnalyticsView>;
}

class FakeOrderValues {
  values: { orderId: string; totalIdr: number }[] | null = [];
  calls: string[][] = [];

  async findOrderValues(orderIds: string[]): Promise<{ orderId: string; totalIdr: number }[] | null> {
    this.calls.push(orderIds);
    return this.values;
  }
}

describe('PromotionService analytics', () => {
  const now = new Date('2026-07-22T12:34:56.000Z');
  let promotions: InMemoryPromotionRepository;
  let vouchers: InMemoryVoucherRepository;
  let orderValues: FakeOrderValues;
  let service: PromotionService & AnalyticsService;

  beforeEach(() => {
    promotions = new InMemoryPromotionRepository();
    vouchers = new InMemoryVoucherRepository();
    orderValues = new FakeOrderValues();
    const PromotionServiceWithAnalytics = PromotionService as unknown as new (
      promotionRepo: PromotionRepository,
      voucherRepo: InMemoryVoucherRepository,
      orderValueSource: FakeOrderValues,
    ) => PromotionService & AnalyticsService;
    service = new PromotionServiceWithAnalytics(promotions, vouchers, orderValues);
  });

  async function createPromotion(voucherCode: string | null) {
    return service.create(base({ title: 'Promo Air', voucherCode }));
  }

  async function createVoucher(code = 'HEMAT10') {
    return vouchers.create({
      code,
      description: null,
      discountType: 'FIXED' as never,
      value: 10_000,
      minSpend: 0,
      maxDiscount: null,
      validFrom: null,
      validUntil: null,
      usageLimit: null,
      perCustomerLimit: 10,
      budgetCap: null,
    });
  }

  it.each([
    ['has no voucher code', null, false],
    ['links a missing voucher', 'MISSING', false],
    ['links a voucher with no redemptions', 'HEMAT10', true],
  ])('returns real zero analytics and skips order lookup when it %s', async (_label, code, seedVoucher) => {
    if (seedVoucher) await createVoucher();
    const promotion = await createPromotion(code);

    const result = await service.analytics(promotion.id, now);

    expect(result).toMatchObject({
      promotionId: promotion.id,
      title: 'Promo Air',
      voucherCode: code,
      totalUses: 0,
      usesLast7Days: 0,
      totalSavingsIdr: 0,
      affectedOrderIds: [],
      affectedOrderCount: 0,
      grossAffectedOrderValueIdr: 0,
      topCustomers: [],
      orderValueSource: 'not_applicable',
    });
    expect(result.dailyUses).toEqual([
      { day: '2026-07-16', uses: 0 },
      { day: '2026-07-17', uses: 0 },
      { day: '2026-07-18', uses: 0 },
      { day: '2026-07-19', uses: 0 },
      { day: '2026-07-20', uses: 0 },
      { day: '2026-07-21', uses: 0 },
      { day: '2026-07-22', uses: 0 },
    ]);
    expect(orderValues.calls).toEqual([]);
  });

  it('aggregates all-time usage, UTC buckets, savings, affected orders, and sorted customers', async () => {
    const voucher = await createVoucher();
    const promotion = await createPromotion(voucher.code);
    const redemptions = [
      ['customer-a', '00000000-0000-4000-8000-000000000001', 100, '2026-07-16T00:00:00.000Z'],
      ['customer-b', '00000000-0000-4000-8000-000000000002', 200, '2026-07-21T23:59:59.000Z'],
      ['customer-a', '00000000-0000-4000-8000-000000000003', 300, '2026-07-22T10:00:00.000Z'],
      ['customer-c', '00000000-0000-4000-8000-000000000004', 600, '2026-07-15T23:59:59.000Z'],
      ['customer-b', '00000000-0000-4000-8000-000000000005', 700, '2026-07-22T23:59:59.000Z'],
    ] as const;
    vouchers.redemptions.push(
      ...redemptions.map(([customerId, orderId, discountApplied, createdAt], index) => ({
        id: `redemption-${index}`,
        voucherId: voucher.id,
        voucherCode: voucher.code,
        customerId,
        orderId,
        discountApplied,
        createdAt: new Date(createdAt),
      })),
    );
    orderValues.values = redemptions.map(([, orderId], index) => ({
      orderId,
      totalIdr: (index + 1) * 10_000,
    }));
    const orderedOrderIds = [...redemptions]
      .sort((a, b) => new Date(a[3]).getTime() - new Date(b[3]).getTime())
      .map(([, orderId]) => orderId);

    const result = await service.analytics(promotion.id, now);

    expect(result.totalUses).toBe(5);
    expect(result.usesLast7Days).toBe(4);
    expect(result.totalSavingsIdr).toBe(1900);
    expect(result.affectedOrderIds).toEqual(orderedOrderIds);
    expect(result.affectedOrderCount).toBe(5);
    expect(result.grossAffectedOrderValueIdr).toBe(150_000);
    expect(result.orderValueSource).toBe('ok');
    expect(result.dailyUses).toEqual([
      { day: '2026-07-16', uses: 1 },
      { day: '2026-07-17', uses: 0 },
      { day: '2026-07-18', uses: 0 },
      { day: '2026-07-19', uses: 0 },
      { day: '2026-07-20', uses: 0 },
      { day: '2026-07-21', uses: 1 },
      { day: '2026-07-22', uses: 2 },
    ]);
    expect(result.topCustomers).toEqual([
      { customerId: 'customer-b', uses: 2, savingsIdr: 900 },
      { customerId: 'customer-a', uses: 2, savingsIdr: 400 },
      { customerId: 'customer-c', uses: 1, savingsIdr: 600 },
    ]);
    expect(orderValues.calls).toEqual([orderedOrderIds]);
  });

  it('returns unavailable gross value when the order source fails open', async () => {
    const voucher = await createVoucher();
    const promotion = await createPromotion(voucher.code);
    vouchers.redemptions.push({
      id: 'redemption-1',
      voucherId: voucher.id,
      voucherCode: voucher.code,
      customerId: 'customer-a',
      orderId: '00000000-0000-4000-8000-000000000001',
      discountApplied: 1000,
      createdAt: now,
    });
    orderValues.values = null;

    const result = await service.analytics(promotion.id, now);

    expect(result.grossAffectedOrderValueIdr).toBeNull();
    expect(result.orderValueSource).toBe('unavailable');
  });
});
