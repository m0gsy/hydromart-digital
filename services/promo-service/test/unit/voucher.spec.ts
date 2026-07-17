import {
  MinSpendNotMetError,
  VoucherBudgetExhaustedError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
  VoucherInactiveError,
  VoucherNotStartedError,
  VoucherUsageExceededError,
} from '../../src/domain/errors';
import { DiscountType, VoucherRules, computeDiscount, validateVoucher } from '../../src/domain/voucher';

const rules = (overrides: Partial<VoucherRules> = {}): VoucherRules => ({
  discountType: DiscountType.PERCENTAGE,
  value: 10,
  minSpend: 0,
  maxDiscount: null,
  validFrom: null,
  validUntil: null,
  usageLimit: null,
  perCustomerLimit: 1,
  budgetCap: null,
  active: true,
  ...overrides,
});

describe('computeDiscount', () => {
  it('takes a floored percentage of the subtotal', () => {
    expect(computeDiscount(rules({ value: 10 }), 60000)).toBe(6000);
    expect(computeDiscount(rules({ value: 15 }), 61234)).toBe(Math.floor(61234 * 0.15));
  });

  it('caps a percentage discount at maxDiscount when set', () => {
    expect(computeDiscount(rules({ value: 50, maxDiscount: 20000 }), 60000)).toBe(20000);
  });

  it('leaves a percentage discount uncapped when maxDiscount is null', () => {
    expect(computeDiscount(rules({ value: 50, maxDiscount: null }), 60000)).toBe(30000);
  });

  it('applies a fixed discount in rupiah', () => {
    expect(computeDiscount(rules({ discountType: DiscountType.FIXED, value: 5000 }), 60000)).toBe(5000);
  });

  it('never exceeds the subtotal', () => {
    expect(computeDiscount(rules({ discountType: DiscountType.FIXED, value: 90000 }), 60000)).toBe(60000);
    expect(computeDiscount(rules({ value: 100, maxDiscount: null }), 60000)).toBe(60000);
  });
});

describe('validateVoucher', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('passes for a valid voucher', () => {
    expect(() => validateVoucher(rules(), 60000, now, 0, 0)).not.toThrow();
  });

  it('rejects an inactive voucher', () => {
    expect(() => validateVoucher(rules({ active: false }), 60000, now, 0, 0)).toThrow(VoucherInactiveError);
  });

  it('rejects a voucher that has not started', () => {
    const validFrom = new Date('2026-07-01T00:00:00.000Z');
    expect(() => validateVoucher(rules({ validFrom }), 60000, now, 0, 0)).toThrow(VoucherNotStartedError);
  });

  it('rejects an expired voucher', () => {
    const validUntil = new Date('2026-05-01T00:00:00.000Z');
    expect(() => validateVoucher(rules({ validUntil }), 60000, now, 0, 0)).toThrow(VoucherExpiredError);
  });

  it('rejects when the subtotal is below minSpend', () => {
    expect(() => validateVoucher(rules({ minSpend: 100000 }), 60000, now, 0, 0)).toThrow(MinSpendNotMetError);
  });

  it('rejects when the global usage limit is reached', () => {
    expect(() => validateVoucher(rules({ usageLimit: 5 }), 60000, now, 5, 0)).toThrow(VoucherUsageExceededError);
  });

  it('rejects when the customer limit is reached', () => {
    expect(() => validateVoucher(rules({ perCustomerLimit: 1 }), 60000, now, 0, 1)).toThrow(
      VoucherCustomerLimitReachedError,
    );
  });

  it('rejects once the discount budget cap is exhausted', () => {
    // Under the cap → ok; at/over the cap → blocked.
    expect(() => validateVoucher(rules({ budgetCap: 100000 }), 60000, now, 0, 0, 99999)).not.toThrow();
    expect(() => validateVoucher(rules({ budgetCap: 100000 }), 60000, now, 0, 0, 100000)).toThrow(
      VoucherBudgetExhaustedError,
    );
  });
});
