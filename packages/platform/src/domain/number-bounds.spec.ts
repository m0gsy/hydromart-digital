import { INT4_MAX, MAX_DAYS, decimalMax } from './number-bounds';

describe('number bounds', () => {
  it('is the int4 ceiling', () => {
    expect(INT4_MAX).toBe(2 ** 31 - 1);
  });

  it("is a Decimal column's largest whole value", () => {
    expect(decimalMax(12, 2)).toBe(9_999_999_999);
    expect(decimalMax(14, 2)).toBe(999_999_999_999);
    expect(decimalMax(12, 3)).toBe(999_999_999);
  });

  it('keeps a day span inside what a timestamp can add', () => {
    expect(MAX_DAYS).toBe(36_500);
  });
});
