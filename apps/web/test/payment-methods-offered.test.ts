import { describe, expect, it } from 'vitest';

import { offeredMethods, PAYMENT_METHODS } from '@/lib/payments';

/*
 * O5 — e-wallet and virtual account are the only methods that need a gateway, and none is
 * configured in production: two buttons that can only fail, offered next to three that
 * work. The server now answers which ones it can take; this is the filter that believes it.
 */
const value = (list: typeof PAYMENT_METHODS) => list.map((m) => m.value);

describe('offeredMethods', () => {
  it('keeps every method the server says it can take', () => {
    expect(value(offeredMethods({ CASH: true, TRANSFER: true, QRIS: true, EWALLET: true, VA: true }))).toEqual(
      value(PAYMENT_METHODS),
    );
  });

  it('drops the gateway methods when the server cannot take them', () => {
    expect(value(offeredMethods({ CASH: true, TRANSFER: true, QRIS: true, EWALLET: false, VA: false }))).toEqual([
      'CASH',
      'TRANSFER',
      'QRIS',
    ]);
  });

  it('hides them when the answer never arrived, rather than offering a certain failure', () => {
    expect(value(offeredMethods(null))).toEqual(['CASH', 'TRANSFER', 'QRIS']);
  });
});
