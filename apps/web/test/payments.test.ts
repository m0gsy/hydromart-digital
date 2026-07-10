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

  it('is false for a cancelled order regardless of payment', () => {
    expect(needsPayment({ status: 'CANCELLED' }, undefined)).toBe(false);
    expect(needsPayment({ status: 'CANCELLED' }, pay('FAILED'))).toBe(false);
  });
});
