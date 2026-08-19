import { describe, expect, it } from 'vitest';

import { codOutstanding } from '@/components/driver/status';
import type { Payment } from '@/lib/types';

const pay = (method: string, status: string) => ({ method, status }) as Payment;

/*
 * C1(c). The courier screen used to offer "Terima uang" on every delivery, prepaid ones
 * included, and never require it on the ones that owed cash — so Selesai was reachable
 * with the payment still PENDING and the end-of-shift deposit expected nothing.
 */
describe('driver COD gate', () => {
  it('is not outstanding when the delivery carries no COD', () => {
    expect(codOutstanding(null, [pay('CASH', 'PENDING')])).toBe(false);
    expect(codOutstanding(undefined, [pay('CASH', 'PENDING')])).toBe(false);
    expect(codOutstanding(0, [pay('CASH', 'PENDING')])).toBe(false);
  });

  it('is outstanding while a cash payment on the order is still PENDING', () => {
    expect(codOutstanding(150000, [pay('CASH', 'PENDING')])).toBe(true);
  });

  it('clears once the cash is confirmed', () => {
    expect(codOutstanding(150000, [pay('CASH', 'PAID')])).toBe(false);
  });

  // `codAmount` is written at assignment and never cleared, so it cannot answer alone.
  it('ignores rows that are not cash the courier is about to be handed', () => {
    expect(codOutstanding(150000, [pay('QRIS', 'PENDING')])).toBe(false);
    expect(codOutstanding(150000, [pay('CASH', 'REFUNDED')])).toBe(false);
    expect(codOutstanding(150000, [pay('CASH', 'CANCELLED')])).toBe(false);
    expect(codOutstanding(150000, [])).toBe(false);
  });

  it('is outstanding when one of several rows is still unpaid cash', () => {
    expect(
      codOutstanding(150000, [pay('CASH', 'REFUNDED'), pay('CASH', 'PENDING')]),
    ).toBe(true);
  });
});
