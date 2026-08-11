/**
 * D5 — one place that turns a stored money value into whole rupiah.
 *
 * Every money column here is `Decimal(12,2)`, and the read side used a bare `Number()`.
 * The write DTOs are `@IsInt()`, so the API cannot create a fractional row — but the CSV
 * import can, and so can data that predates the DTO, and the schema permits it. Nothing
 * objected on the way out: `12_500.50` entered `gross` as a float, that float became the
 * base for BPJS and PPh 21, and it was stored as `net`. A payslip printing an amount that
 * cannot exist in the currency, off by cents that compound across every derived line.
 *
 * Rounding at the point of READ, rather than at each call site, is what catches every
 * source at once — including the next one somebody adds.
 *
 * `basePay` and the tenure uplift already rounded; this is the same rule, named.
 */
export function rupiah(value: unknown): number {
  const n = Number(value);
  // NaN is the dangerous input, not the wrong one: it propagates silently through gross,
  // through the statutory calculations, and stores as NaN. Zero is visible and wrong;
  // NaN is invisible and wrong.
  return Number.isFinite(n) ? Math.round(n) : 0;
}
