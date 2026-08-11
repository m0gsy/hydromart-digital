import { rupiah } from '../../src/domain/rupiah';

/**
 * D5 — money read out of `Decimal(12,2)` with a bare `Number()`.
 *
 * The write DTOs are `@IsInt()`, so the API cannot create a fractional row. The CSV import
 * and pre-existing data can, and the schema allows it. Nothing on the read side objected:
 * `12_500.50` entered `gross` as a float, and that float became the base for BPJS and
 * PPh 21 and was stored as `net` — a payslip printing a rupiah amount that cannot exist,
 * off by cents that compound across every derived line.
 *
 * Indonesian payroll has no sub-rupiah unit. Rounding at the point of READ is the only
 * place that catches every source at once.
 */
describe('rupiah', () => {
  it('rounds a fractional amount to whole rupiah', () => {
    expect(rupiah(12_500.5)).toBe(12_501);
    expect(rupiah(12_500.49)).toBe(12_500);
  });

  it('leaves a whole amount exactly alone', () => {
    expect(rupiah(2_750_000)).toBe(2_750_000);
  });

  it('reads a Decimal-shaped string, which is what Prisma hands back', () => {
    expect(rupiah('1500.75')).toBe(1_501);
  });

  it('treats null, undefined and unparseable input as zero rather than NaN', () => {
    // NaN in `gross` propagates silently through every derived line and stores as NaN.
    expect(rupiah(null)).toBe(0);
    expect(rupiah(undefined)).toBe(0);
    expect(rupiah('bukan angka')).toBe(0);
  });

  it('keeps a negative amount negative — a deduction correction is a real thing', () => {
    expect(rupiah(-250.4)).toBe(-250);
  });
});
