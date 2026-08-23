import { describe, expect, it } from 'vitest';

import { voucherToApply } from '@/lib/vouchers';

/*
 * K1.2 — three conditions, one right answer each. Inside the checkout page these lived in
 * an effect nothing could hold; here they are a function a test can.
 */
describe('voucherToApply', () => {
  it('applies a carried code once the cart is priced', () => {
    expect(voucherToApply('hemat10', true, false)).toBe('HEMAT10');
    expect(voucherToApply('  hemat10 ', true, false)).toBe('HEMAT10');
  });

  it('waits for the cart — a quote without a subtotal rejects a good voucher', () => {
    expect(voucherToApply('HEMAT10', false, false)).toBeNull();
  });

  it('never applies twice', () => {
    expect(voucherToApply('HEMAT10', true, true)).toBeNull();
  });

  it('does nothing when nothing was carried', () => {
    expect(voucherToApply(null, true, false)).toBeNull();
    expect(voucherToApply('   ', true, false)).toBeNull();
  });
});
