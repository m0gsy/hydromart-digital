import { money } from '../src/domain/money';

/**
 * The rounding rule every order total, payment amount and discount passes through — and the
 * one thing in this package that had no spec of its own. It was only exercised incidentally
 * (`business-time.spec.ts` imports the module), so the contract that order-service and
 * payment-service both depend on for SEC-1 (`payment.amount` must equal `order.total`) was
 * asserted nowhere.
 *
 * Whole rupiah since 2026-08-13. The cases below are the ones that were wrong before: a
 * percentage discount landing on a fraction used to be stored as `4999.95` while the screen
 * showed `4999`.
 */
describe('money', () => {
  it('rounds a fractional amount to whole rupiah', () => {
    expect(money(4999.95)).toBe(5000);
    expect(money(4999.04)).toBe(4999);
  });

  it('rounds half up, the same way the web client does', () => {
    expect(money(0.5)).toBe(1);
    expect(money(1.5)).toBe(2);
  });

  it('leaves a whole amount exactly as it is', () => {
    for (const v of [0, 1, 19_000, 1_234_567]) expect(money(v)).toBe(v);
  });

  it('keeps a percentage discount payable', () => {
    // 5% of 99,999 = 4,999.95 — an amount no cashier can take and no receipt can print.
    expect(money(99_999 * 0.05)).toBe(5000);
  });

  it('is idempotent, so passing an already-rounded total through again is safe', () => {
    const once = money(20_000 * 1.11);
    expect(money(once)).toBe(once);
  });

  it('rounds a negative amount away from a phantom fraction too', () => {
    // Reversals and refunds go through the same helper.
    expect(money(-4999.95)).toBe(-5000);
  });
});
