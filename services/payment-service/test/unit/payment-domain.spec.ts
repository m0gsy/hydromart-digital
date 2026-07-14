import {
  PaymentMethod,
  PaymentStatus,
  canTransition,
  isOnlineMethod,
  isRefundable,
} from '../../src/domain/payment';

describe('Payment domain', () => {
  it('classifies online vs offline methods', () => {
    expect(isOnlineMethod(PaymentMethod.EWALLET)).toBe(true);
    expect(isOnlineMethod(PaymentMethod.VA)).toBe(true);
    expect(isOnlineMethod(PaymentMethod.CASH)).toBe(false);
    expect(isOnlineMethod(PaymentMethod.TRANSFER)).toBe(false);
    // QRIS is a direct-to-depot manual method (static QRIS confirmed by staff), not gateway.
    expect(isOnlineMethod(PaymentMethod.QRIS)).toBe(false);
  });

  it('allows only legal status transitions', () => {
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.PAID)).toBe(true);
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.FAILED)).toBe(true);
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.CANCELLED)).toBe(true);
    expect(canTransition(PaymentStatus.PAID, PaymentStatus.REFUNDED)).toBe(true);
    expect(canTransition(PaymentStatus.PENDING, PaymentStatus.REFUNDED)).toBe(false);
    expect(canTransition(PaymentStatus.PAID, PaymentStatus.PENDING)).toBe(false);
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.PAID)).toBe(false);
  });

  it('marks only PAID payments refundable', () => {
    expect(isRefundable(PaymentStatus.PAID)).toBe(true);
    expect(isRefundable(PaymentStatus.PENDING)).toBe(false);
    expect(isRefundable(PaymentStatus.REFUNDED)).toBe(false);
  });
});
