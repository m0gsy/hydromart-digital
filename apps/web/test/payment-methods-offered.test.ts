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

/*
 * L2.3 — the same O5 principle, one layer down, where it had never been applied.
 *
 * Payment here is direct-to-depot: there is no gateway, so a transfer means the customer
 * sends money to THAT depot's bank account and a QRIS means they scan THAT depot's printed
 * code. The server's answer above is about the platform — it says TRANSFER and QRIS with a
 * hardcoded `true` — and it cannot know whether the depot fulfilling this particular order
 * has ever been given either.
 *
 * Production, asked on 2026-08-26: three active depots, ZERO with a bank account, ZERO with
 * a QRIS image. So both buttons were offered to every customer, and both led to an order
 * placed with no way to pay for it — exactly the failure O5 was written to end.
 *
 * CASH is unconditional and stays, so there is always a way to pay.
 */
describe('offeredMethods, for the depot actually fulfilling the order', () => {
  const server = { CASH: true, TRANSFER: true, QRIS: true, EWALLET: false, VA: false };

  it('drops transfer when the depot has no bank account to transfer to', () => {
    expect(
      value(offeredMethods(server, { paymentBankAccountNumber: null, paymentQrisImageUrl: 'qris.png' })),
    ).toEqual(['CASH', 'QRIS']);
  });

  it('drops QRIS when the depot has no QRIS code to scan', () => {
    expect(
      value(offeredMethods(server, { paymentBankAccountNumber: '1234567890', paymentQrisImageUrl: null })),
    ).toEqual(['CASH', 'TRANSFER']);
  });

  it('leaves cash alone when the depot can take neither — production today', () => {
    expect(
      value(offeredMethods(server, { paymentBankAccountNumber: null, paymentQrisImageUrl: null })),
    ).toEqual(['CASH']);
  });

  it('treats whitespace as no account, because a space cannot be transferred to', () => {
    expect(
      value(offeredMethods(server, { paymentBankAccountNumber: '   ', paymentQrisImageUrl: null })),
    ).toEqual(['CASH']);
  });

  /*
   * The depot is not always known: /orders/detail can render before it loads, and passing
   * nothing must not silently strip two working methods. Absent depot = no depot opinion.
   */
  it('keeps both when the depot is not known yet', () => {
    expect(value(offeredMethods(server, null))).toEqual(['CASH', 'TRANSFER', 'QRIS']);
  });
});
