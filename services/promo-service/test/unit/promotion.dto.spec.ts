import { PromotionAnalyticsDto } from '../../src/modules/dto/promotion.dto';

describe('PromotionAnalyticsDto', () => {
  it('preserves the full analytics contract', () => {
    const value = {
      promotionId: '00000000-0000-4000-8000-000000000001',
      title: 'Promo Air',
      voucherCode: 'HEMAT10',
      totalUses: 1,
      usesLast7Days: 1,
      totalSavingsIdr: 5000,
      affectedOrderIds: ['00000000-0000-4000-8000-000000000002'],
      affectedOrderCount: 1,
      grossAffectedOrderValueIdr: 50_000,
      dailyUses: [{ day: '2026-07-22', uses: 1 }],
      topCustomers: [{ customerId: 'customer-1', uses: 1, savingsIdr: 5000 }],
      orderValueSource: 'ok' as const,
    };

    expect(PromotionAnalyticsDto.from(value)).toEqual(value);
  });
});
