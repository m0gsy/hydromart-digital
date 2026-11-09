import { describe, expect, it } from 'vitest';

import { needsPayment } from '@/lib/payments';
import type { Payment, PaymentStatus } from '@/lib/types';

const pay = (status: PaymentStatus): Payment => ({ status }) as Payment;

describe('needsPayment', () => {
  it('is true when the order has no payment yet', () => {
    expect(needsPayment({ status: 'CREATED' }, undefined)).toBe(true);
  });

  it('is true when the last payment FAILED or was CANCELLED', () => {
    expect(needsPayment({ status: 'CREATED' }, pay('FAILED'))).toBe(true);
    expect(needsPayment({ status: 'CONFIRMED' }, pay('CANCELLED'))).toBe(true);
  });

  it('is false while a payment is PENDING or PAID', () => {
    expect(needsPayment({ status: 'CREATED' }, pay('PENDING'))).toBe(false);
    expect(needsPayment({ status: 'CONFIRMED' }, pay('PAID'))).toBe(false);
  });

  // WEB-08: an order that is over - voided at the till, or completed - must not bring the pay panel
  // back just because its payment was refunded.
  it('is false for a voided or completed order, even when its payment was refunded', () => {
    expect(needsPayment({ status: 'VOIDED' }, pay('REFUNDED'))).toBe(false);
    expect(needsPayment({ status: 'COMPLETED' }, pay('REFUNDED'))).toBe(false);
    expect(needsPayment({ status: 'COMPLETED' }, undefined)).toBe(false);
    // Still needs paying while it is in flight.
    expect(needsPayment({ status: 'ON_DELIVERY' }, undefined)).toBe(true);
  });

  it('is false for a cancelled order regardless of payment', () => {
    expect(needsPayment({ status: 'CANCELLED' }, undefined)).toBe(false);
    expect(needsPayment({ status: 'CANCELLED' }, pay('FAILED'))).toBe(false);
  });
});
