import {
  DEFAULT_TAX_ROUNDING,
  TaxRounding,
  computePpn,
  isTaxRounding,
  roundIdr,
} from '../../src/domain/tax';

describe('roundIdr', () => {
  it('defaults to PER-11/2025 half-up (M29-10)', () => {
    expect(DEFAULT_TAX_ROUNDING).toBe(TaxRounding.HALF_UP);
    expect(roundIdr(0.5)).toBe(1);
    expect(roundIdr(1.5)).toBe(2);
    expect(roundIdr(2.5)).toBe(3);
    expect(roundIdr(0.49)).toBe(0);
  });

  it('breaks ties toward the even neighbour under HALF_EVEN', () => {
    expect(roundIdr(0.5, TaxRounding.HALF_EVEN)).toBe(0);
    expect(roundIdr(1.5, TaxRounding.HALF_EVEN)).toBe(2);
    expect(roundIdr(2.5, TaxRounding.HALF_EVEN)).toBe(2);
    expect(roundIdr(3.5, TaxRounding.HALF_EVEN)).toBe(4);
    // Non-ties behave like ordinary rounding.
    expect(roundIdr(2.6, TaxRounding.HALF_EVEN)).toBe(3);
    expect(roundIdr(2.4, TaxRounding.HALF_EVEN)).toBe(2);
  });

  it('truncates toward zero under DOWN', () => {
    expect(roundIdr(2.9, TaxRounding.DOWN)).toBe(2);
    expect(roundIdr(-2.9, TaxRounding.DOWN)).toBe(-2);
  });

  it('rounds negatives symmetrically so a refund cancels its charge exactly', () => {
    for (const method of [TaxRounding.HALF_UP, TaxRounding.HALF_EVEN, TaxRounding.DOWN]) {
      expect(roundIdr(-2.5, method)).toBe(-roundIdr(2.5, method));
      expect(roundIdr(-1234.5, method)).toBe(-roundIdr(1234.5, method));
    }
  });
});

describe('computePpn', () => {
  it('adds tax on top when the price excludes it', () => {
    expect(computePpn(100_000, 11, false)).toBe(11_000);
  });

  it('carves tax out when the price already includes it', () => {
    // 100000 gross at 11% => 100000 * 11/111 = 9909.909...
    expect(computePpn(100_000, 11, true)).toBe(9910);
    expect(computePpn(100_000, 11, true, TaxRounding.DOWN)).toBe(9909);
  });

  it('is zero when no tax applies', () => {
    expect(computePpn(100_000, 0, false)).toBe(0);
    expect(computePpn(100_000, -1, true)).toBe(0);
  });

  it('honours the configured method on a tie', () => {
    // 50 at 1% => 0.5 exactly.
    expect(computePpn(50, 1, false, TaxRounding.HALF_UP)).toBe(1);
    expect(computePpn(50, 1, false, TaxRounding.HALF_EVEN)).toBe(0);
    expect(computePpn(50, 1, false, TaxRounding.DOWN)).toBe(0);
  });
});

describe('isTaxRounding', () => {
  it('accepts the three known methods and rejects anything else', () => {
    expect(isTaxRounding('HALF_UP')).toBe(true);
    expect(isTaxRounding('HALF_EVEN')).toBe(true);
    expect(isTaxRounding('DOWN')).toBe(true);
    expect(isTaxRounding('BANKERS')).toBe(false);
    expect(isTaxRounding(null)).toBe(false);
    expect(isTaxRounding(undefined)).toBe(false);
  });
});
