import {
  MinSpendNotMetError,
  VoucherBudgetExhaustedError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
  VoucherInactiveError,
  VoucherNotStartedError,
  VoucherUsageExceededError,
  VoucherWrongDepotError,
} from '../../src/domain/errors';
import {
  DiscountType,
  VoucherRules,
  computeDiscount,
  validateVoucher,
} from '../../src/domain/voucher';

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
  /*
   * ROUNDED, by the platform's shared `money()` — not floored.
   *
   * The platform has one rupiah rule (half-up) and its header says why: two private copies
   * of a rounding rule is one copy away from two different rounding rules. This was the
   * copy. A 15% MEMBERSHIP discount on Rp4.999 came to 750 and a 15% VOUCHER on the same
   * basket came to 749, and nobody could see it because each mechanism is internally
   * consistent end to end.
   *
   * Asserted against `Math.round`, not a literal: the point is that this agrees with the
   * shared rule, and a literal would still pass if the rule itself changed underneath.
   */
  it('rounds a percentage of the subtotal the way the rest of the platform does', () => {
    expect(computeDiscount(rules({ value: 10 }), 60000)).toBe(6000);
    expect(computeDiscount(rules({ value: 15 }), 61234)).toBe(Math.round(61234 * 0.15));
  });

  // The case that separates the two rules. 15% of 4.999 is 749,85 — floor says 749, the
  // platform says 750, and the customer is charged a rupiah either way it goes.
  it('gives the same rupiah as a membership discount on a basket that rounds up', () => {
    expect(computeDiscount(rules({ value: 15 }), 4999)).toBe(750);
  });

  it('caps a percentage discount at maxDiscount when set', () => {
    expect(computeDiscount(rules({ value: 50, maxDiscount: 20000 }), 60000)).toBe(20000);
  });

  it('leaves a percentage discount uncapped when maxDiscount is null', () => {
    expect(computeDiscount(rules({ value: 50, maxDiscount: null }), 60000)).toBe(30000);
  });

  it('applies a fixed discount in rupiah', () => {
    expect(computeDiscount(rules({ discountType: DiscountType.FIXED, value: 5000 }), 60000)).toBe(
      5000,
    );
  });

  it('never exceeds the subtotal', () => {
    expect(computeDiscount(rules({ discountType: DiscountType.FIXED, value: 90000 }), 60000)).toBe(
      60000,
    );
    expect(computeDiscount(rules({ value: 100, maxDiscount: null }), 60000)).toBe(60000);
  });

  it('waives the delivery fee for a FREE_SHIPPING voucher', () => {
    const v = rules({ discountType: DiscountType.FREE_SHIPPING, value: 0 });
    expect(computeDiscount(v, 60000, 8000)).toBe(8000); // full shipping fee
    expect(computeDiscount(v, 60000, 0)).toBe(0); // free pickup → nothing to waive
    // Capped by maxDiscount when set (e.g. subsidise shipping up to 5000).
    expect(
      computeDiscount(
        rules({ discountType: DiscountType.FREE_SHIPPING, maxDiscount: 5000 }),
        60000,
        8000,
      ),
    ).toBe(5000);
  });
});

describe('validateVoucher', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('passes for a valid voucher', () => {
    expect(() => validateVoucher(rules(), 60000, now, 0, 0)).not.toThrow();
  });

  it('rejects an inactive voucher', () => {
    expect(() => validateVoucher(rules({ active: false }), 60000, now, 0, 0)).toThrow(
      VoucherInactiveError,
    );
  });

  it('rejects a voucher that has not started', () => {
    const validFrom = new Date('2026-07-01T00:00:00.000Z');
    expect(() => validateVoucher(rules({ validFrom }), 60000, now, 0, 0)).toThrow(
      VoucherNotStartedError,
    );
  });

  it('rejects an expired voucher', () => {
    const validUntil = new Date('2026-05-01T00:00:00.000Z');
    expect(() => validateVoucher(rules({ validUntil }), 60000, now, 0, 0)).toThrow(
      VoucherExpiredError,
    );
  });

  it('rejects when the subtotal is below minSpend', () => {
    expect(() => validateVoucher(rules({ minSpend: 100000 }), 60000, now, 0, 0)).toThrow(
      MinSpendNotMetError,
    );
  });

  it('rejects when the global usage limit is reached', () => {
    expect(() => validateVoucher(rules({ usageLimit: 5 }), 60000, now, 5, 0)).toThrow(
      VoucherUsageExceededError,
    );
  });

  it('rejects when the customer limit is reached', () => {
    expect(() => validateVoucher(rules({ perCustomerLimit: 1 }), 60000, now, 0, 1)).toThrow(
      VoucherCustomerLimitReachedError,
    );
  });

  it('rejects the redemption that would take the budget past its cap', () => {
    // Hard cap: the burn passed in already includes this order's own discount, so
    // landing exactly on the cap is allowed and the first rupiah over is rejected.
    expect(() =>
      validateVoucher(rules({ budgetCap: 100000 }), 60000, now, 0, 0, 100000),
    ).not.toThrow();
    expect(() => validateVoucher(rules({ budgetCap: 100000 }), 60000, now, 0, 0, 100001)).toThrow(
      VoucherBudgetExhaustedError,
    );
  });
});

/*
 * CA-2-65: a depot's voucher, spendable across the whole network.
 *
 * `VoucherRequest` carries `depotId` and `depotName` — a depot manager proposes a promo for
 * their own area and head office approves it. `Voucher` had no depot column at all, so the
 * approval created a code every customer in the network could spend, funded by the depot
 * that asked for one promo on their own street.
 */
describe('validateVoucher depot scope (CA-2-65)', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');

  it('lets a network-wide voucher through at any depot, and with no depot at all', () => {
    expect(() =>
      validateVoucher(rules({ depotId: null }), 60000, now, 0, 0, 0, 'd-1'),
    ).not.toThrow();
    expect(() =>
      validateVoucher(rules({ depotId: null }), 60000, now, 0, 0, 0, null),
    ).not.toThrow();
    expect(() => validateVoucher(rules(), 60000, now, 0, 0)).not.toThrow();
  });

  it('lets a depot voucher through at its own depot', () => {
    expect(() =>
      validateVoucher(rules({ depotId: 'd-1' }), 60000, now, 0, 0, 0, 'd-1'),
    ).not.toThrow();
  });

  it('refuses a depot voucher at another depot', () => {
    expect(() => validateVoucher(rules({ depotId: 'd-1' }), 60000, now, 0, 0, 0, 'd-2')).toThrow(
      VoucherWrongDepotError,
    );
  });

  /*
   * The unknown case is NOT the permissive one. A caller that cannot say which depot — an
   * older client, a path with no depot — must not be the way a scoped voucher escapes; that
   * would leave the same hole open under a new name.
   */
  it('refuses a depot voucher when the caller cannot say which depot', () => {
    expect(() => validateVoucher(rules({ depotId: 'd-1' }), 60000, now, 0, 0)).toThrow(
      VoucherWrongDepotError,
    );
    expect(() => validateVoucher(rules({ depotId: 'd-1' }), 60000, now, 0, 0, 0, null)).toThrow(
      VoucherWrongDepotError,
    );
  });
});
