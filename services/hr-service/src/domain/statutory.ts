// Indonesian statutory payroll deductions: BPJS and PPh 21 (Q-13).
//
// The payroll engine computed net as gross + bonus − deductions, where "deductions" meant
// lateness, absence, manual rows and loan instalments. No BPJS, no income tax. Every
// payslip it produced was therefore higher than what an employee is actually paid, and
// the company was under-withholding tax it is legally on the hook for.
//
// Two design decisions worth knowing before editing:
//
// 1. EVERY rate, ceiling and threshold is a parameter, not a literal. Indonesian tax and
//    BPJS numbers move on their own schedule — the JP ceiling is re-issued annually — and
//    an accountant must be able to correct them from the settings screen rather than
//    waiting for a deploy. The values shipped as defaults are the ones in force at the
//    time of writing, and they are documented in config/setting-defs.ts next to their
//    legal source.
//
// 2. Monthly PPh 21 is computed by the TER table (PMK 168/2023) when one is loaded, and by
//    the ANNUALISED PROGRESSIVE estimate when it is not. Both reach the same annual
//    liability — which December now reconciles against — but they differ month to month
//    for someone whose pay varies, and TER is the method the regulation requires for
//    monthly withholding from 2024.
//
//    The table itself is CONFIGURATION, like every other number in this file, and ships
//    EMPTY. Its rates are a legal document, not a constant to be recalled from memory: a
//    wrong rate takes the wrong amount off somebody's pay, every month, silently. An
//    accountant loads the three categories once from the PMK; `assertTerTable` refuses a
//    partial or unsorted one; and until that happens the annualised method runs exactly as
//    it did before, so nobody's payslip moves without that deliberate act.

/** PTKP status codes, mirroring the Prisma enum. TK = single, K = married, digit = dependants. */
export type PtkpCode = 'TK0' | 'TK1' | 'TK2' | 'TK3' | 'K0' | 'K1' | 'K2' | 'K3';

export interface StatutoryRates {
  /** BPJS Kesehatan employee share, percent of wage (statutory 1%). */
  healthEmployeePct: number;
  /** Wage ceiling for BPJS Kesehatan, IDR/month (statutory Rp 12.000.000). */
  healthCeilingIdr: number;
  /** JHT (old-age) employee share, percent (statutory 2%). No ceiling. */
  jhtEmployeePct: number;
  /** JP (pension) employee share, percent (statutory 1%). */
  jpEmployeePct: number;
  /** Wage ceiling for JP, IDR/month — re-issued annually by BPJS. */
  jpCeilingIdr: number;
  /** Biaya jabatan: percent of gross, and its monthly cap (statutory 5% / Rp 500.000). */
  occupationalCostPct: number;
  occupationalCostCapIdr: number;
  /** Surcharge on PPh 21 for an employee with no NPWP, percent extra (statutory 20%). */
  noNpwpSurchargePct: number;
}

/**
 * Annual PTKP (non-taxable income) by status, IDR — PMK 101/2016.
 *
 * TK/0 is the base; marriage adds one allowance and each dependant adds another, capped
 * at three. Expressed as a table rather than arithmetic because that is how the
 * regulation reads, and because a reader checking it against the regulation should not
 * have to re-derive it.
 */
export const PTKP_ANNUAL_IDR: Record<PtkpCode, number> = {
  TK0: 54_000_000,
  TK1: 58_500_000,
  TK2: 63_000_000,
  TK3: 67_500_000,
  K0: 58_500_000,
  K1: 63_000_000,
  K2: 67_500_000,
  K3: 72_000_000,
};

/**
 * PPh 21 progressive brackets — UU 7/2021 (HPP) Article 17(1)(a), in force from 2022.
 * `upTo` is the top of the band in annual IDR; the last band is open-ended.
 */
export const PPH21_BRACKETS: readonly { upTo: number; rate: number }[] = [
  { upTo: 60_000_000, rate: 0.05 },
  { upTo: 250_000_000, rate: 0.15 },
  { upTo: 500_000_000, rate: 0.25 },
  { upTo: 5_000_000_000, rate: 0.3 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.35 },
];

/**
 * December's annual reconciliation IS computed now — `pph21December` below — against the
 * year-to-date figures `pph21_withholding` accumulates. The flag stays as `false` so a
 * reader who followed a reference to it lands on the answer rather than on nothing.
 */
export const ANNUAL_RECONCILIATION_TODO = false;

/**
 * TER category. PMK 168/2023 sorts employees into three by PTKP status, then reads a
 * monthly rate off that category's table by gross.
 *
 * A: TK/0, TK/1, K/0 · B: TK/2, TK/3, K/1, K/2 · C: K/3.
 */
export type TerCategory = 'A' | 'B' | 'C';

const TER_CATEGORY: Record<PtkpCode, TerCategory> = {
  TK0: 'A',
  TK1: 'A',
  K0: 'A',
  TK2: 'B',
  TK3: 'B',
  K1: 'B',
  K2: 'B',
  K3: 'C',
};

export const terCategoryFor = (ptkp: PtkpCode): TerCategory => TER_CATEGORY[ptkp];

/**
 * One row of a TER table: everything up to and including `upToIdr` of MONTHLY gross is
 * withheld at `rate` (a fraction, so 0.0025 = 0.25%). The last row must be open-ended.
 */
export interface TerBand {
  upToIdr: number;
  rate: number;
}

export type TerTable = Partial<Record<TerCategory, readonly TerBand[]>>;

/**
 * Refuse a table that would withhold the wrong amount rather than half-apply it.
 *
 * A partially-typed table is the dangerous case: category A loaded and B missing means
 * every married employee with two dependants silently falls back to a different method
 * mid-year. Ascending order matters because the lookup takes the first band that fits, and
 * an open-ended last row is what makes a high earner computable at all.
 *
 * Returns the reason it refused, or null when the table is usable.
 */
export function assertTerTable(table: TerTable): string | null {
  const present = (['A', 'B', 'C'] as const).filter((c) => (table[c]?.length ?? 0) > 0);
  if (present.length === 0) return null; // not configured at all — a valid state, not an error
  if (present.length < 3) {
    const missing = (['A', 'B', 'C'] as const).filter((c) => !present.includes(c));
    return `TER table is incomplete: category ${missing.join(', ')} has no bands`;
  }
  for (const category of present) {
    const bands = table[category] ?? [];
    let previous = -1;
    for (const band of bands) {
      if (!(band.upToIdr > previous)) return `TER category ${category} bands are not ascending`;
      if (band.rate < 0 || band.rate > 1) {
        return `TER category ${category} has a rate of ${band.rate} — rates are fractions, so 0.05 is 5%`;
      }
      previous = band.upToIdr;
    }
    const last = bands[bands.length - 1];
    if (!last || Number.isFinite(last.upToIdr)) {
      return `TER category ${category} has no open-ended top band, so a high earner cannot be computed`;
    }
  }
  return null;
}

/** The monthly rate for `grossIdr` in `bands` — the first band it fits under. */
export function terRate(grossIdr: number, bands: readonly TerBand[]): number {
  for (const band of bands) {
    if (grossIdr <= band.upToIdr) return band.rate;
  }
  return bands.length ? bands[bands.length - 1].rate : 0;
}

export interface StatutoryInput {
  /** Monthly gross: base + allowances. The BPJS and PPh 21 base. */
  grossIdr: number;
  ptkpStatus: PtkpCode | null;
  /** An employee with no NPWP on file pays the surcharge. */
  hasNpwp: boolean;
  /**
   * Registered for BPJS Kesehatan — i.e. has a `bpjsKes` number on file.
   *
   * Enrolment gates the deduction because it is what makes it lawful: money cannot be
   * taken off someone's pay for a scheme they are not in, and there would be nowhere to
   * remit it to. An unenrolled employee showing no BPJS line is correct, and the gap is
   * visible on the payslip rather than silently absorbed into net.
   */
  enrolledHealth: boolean;
  /** Registered for BPJS Ketenagakerjaan (`bpjsTk` on file) — gates JHT and JP. */
  enrolledEmployment: boolean;
}

export interface StatutoryDeduction {
  /** Payslip label, Indonesian — this is what the employee reads. */
  label: string;
  amountIdr: number;
}

/** Rounds to whole rupiah. Payslips do not carry sen, and neither does the bank transfer. */
const rupiah = (value: number): number => Math.round(value);

/** `pct` percent of `base`, with `base` first capped at `ceiling` (0 = no ceiling). */
function contribution(base: number, pct: number, ceiling: number): number {
  const capped = ceiling > 0 ? Math.min(base, ceiling) : base;
  return rupiah((capped * pct) / 100);
}

/**
 * The employee's BPJS contributions for one month.
 *
 * Employee side only. The employer's share (JKK, JKM, and the larger halves of Kesehatan,
 * JHT and JP) is a real company cost but does not touch take-home pay, which is what this
 * function is for — modelling it belongs with the operational P&L, not the payslip.
 */
export function bpjsEmployeeDeductions(
  input: StatutoryInput,
  rates: StatutoryRates,
): StatutoryDeduction[] {
  const out: StatutoryDeduction[] = [];
  if (input.enrolledHealth) {
    const health = contribution(input.grossIdr, rates.healthEmployeePct, rates.healthCeilingIdr);
    if (health > 0) out.push({ label: 'BPJS Kesehatan (karyawan)', amountIdr: health });
  }
  if (input.enrolledEmployment) {
    const jht = contribution(input.grossIdr, rates.jhtEmployeePct, 0);
    if (jht > 0) out.push({ label: 'BPJS JHT (karyawan)', amountIdr: jht });
    const jp = contribution(input.grossIdr, rates.jpEmployeePct, rates.jpCeilingIdr);
    if (jp > 0) out.push({ label: 'BPJS Jaminan Pensiun (karyawan)', amountIdr: jp });
  }
  return out;
}

/** Tax on `annualTaxableIdr` under the Article 17 brackets, marginal band by band. */
export function progressiveTax(annualTaxableIdr: number): number {
  let remaining = Math.max(0, annualTaxableIdr);
  let floor = 0;
  let tax = 0;
  for (const band of PPH21_BRACKETS) {
    if (remaining <= 0) break;
    const width = band.upTo - floor;
    const taxed = Math.min(remaining, width);
    tax += taxed * band.rate;
    remaining -= taxed;
    floor = band.upTo;
  }
  return tax;
}

export interface Pph21Result {
  monthlyIdr: number;
  /** Annual taxable income after every deduction — shown so a payslip can be checked. */
  annualTaxableIdr: number;
}

/**
 * Monthly PPh 21 withholding, annualised-progressive method.
 *
 * Gross × 12, minus annualised biaya jabatan (capped), minus the employee's annualised
 * BPJS contributions, minus PTKP; the remainder is rounded DOWN to the nearest thousand
 * (the regulation's rule) and run through the brackets; the result is divided by twelve.
 *
 * Returns zero — never a negative — when PTKP already covers the income, which is the
 * normal case for most depot staff.
 */
export function pph21Monthly(
  input: StatutoryInput,
  bpjsEmployeeMonthlyIdr: number,
  rates: StatutoryRates,
  /**
   * The TER table, when one is loaded. Present and valid = the method PMK 168/2023
   * requires; absent = the annualised progressive estimate below, unchanged.
   */
  ter?: TerTable,
): Pph21Result {
  // No PTKP status on file means we cannot compute a lawful figure. Withholding an
  // invented amount from someone's pay is worse than withholding none: it takes money we
  // cannot justify. The gap surfaces as a missing payslip line, and employee.service
  // already captures ptkpStatus — this is a data-entry gap, not a silent zero.
  if (!input.ptkpStatus) return { monthlyIdr: 0, annualTaxableIdr: 0 };

  // TER first when configured: a flat rate on the month's gross, read off the category's
  // table. No PTKP subtraction here — the table already carries it, which is the whole
  // point of the method. `annualTaxableIdr` stays 0 because TER computes no such figure;
  // December's reconciliation is what produces the annual number.
  const bands = ter?.[terCategoryFor(input.ptkpStatus)];
  if (bands?.length) {
    let monthly = input.grossIdr * terRate(input.grossIdr, bands);
    if (!input.hasNpwp) monthly *= 1 + rates.noNpwpSurchargePct / 100;
    return { monthlyIdr: rupiah(monthly), annualTaxableIdr: 0 };
  }

  const annualGross = input.grossIdr * 12;
  const occupationalCost = Math.min(
    (input.grossIdr * rates.occupationalCostPct) / 100,
    rates.occupationalCostCapIdr,
  );
  const annualNet = annualGross - occupationalCost * 12 - bpjsEmployeeMonthlyIdr * 12;
  const taxable = annualNet - PTKP_ANNUAL_IDR[input.ptkpStatus];
  if (taxable <= 0) return { monthlyIdr: 0, annualTaxableIdr: 0 };

  // Penghasilan Kena Pajak is rounded down to the nearest full thousand rupiah.
  const rounded = Math.floor(taxable / 1000) * 1000;
  let annualTax = progressiveTax(rounded);
  if (!input.hasNpwp) {
    annualTax *= 1 + rates.noNpwpSurchargePct / 100;
  }
  return { monthlyIdr: rupiah(annualTax / 12), annualTaxableIdr: rounded };
}

/**
 * Every statutory deduction for one month, in payslip order: BPJS first, then the tax
 * computed on what is left. Order matters — the employee's BPJS contributions are
 * themselves deductible against PPh 21, so the tax cannot be computed before them.
 */
export function statutoryDeductions(
  input: StatutoryInput,
  rates: StatutoryRates,
  ter?: TerTable,
): StatutoryDeduction[] {
  const bpjs = bpjsEmployeeDeductions(input, rates);
  const bpjsTotal = bpjs.reduce((sum, d) => sum + d.amountIdr, 0);
  const tax = pph21Monthly(input, bpjsTotal, rates, ter);
  return tax.monthlyIdr > 0
    ? [...bpjs, { label: 'PPh 21', amountIdr: tax.monthlyIdr }]
    : bpjs;
}

/** What the year has already taken off this employee, before December is computed. */
export interface Pph21YearToDate {
  /** Gross paid in months 1..11 of the year (base + allowances, the PPh 21 base). */
  grossIdr: number;
  /** Employee BPJS withheld across those months — deductible against the annual tax. */
  bpjsIdr: number;
  /** PPh 21 already withheld across those months. */
  withheldIdr: number;
  /** Months already paid. 11 is a full year of prior months; fewer means a mid-year join. */
  months: number;
}

export interface Pph21DecemberResult {
  /** What December must withhold — never negative. */
  monthlyIdr: number;
  /** The year's total liability, for the payslip line and the 1721-A1. */
  annualTaxIdr: number;
  /** Annual taxable income (PKP) the liability was computed on. */
  annualTaxableIdr: number;
  /**
   * Over-withholding found: the year took more than the year owed. December cannot hand
   * money back through payroll — a refund is claimed on the employee's annual filing — so
   * this is reported rather than netted, and December withholds zero.
   */
  overWithheldIdr: number;
}

/**
 * December's reconciliation: the year's actual liability, minus everything already taken.
 *
 * This is the month that makes the other eleven honest. Whichever method ran monthly — TER
 * or the annualised estimate — its figures were an estimate against a year that had not
 * happened yet: a raise, a bonus month, a mid-year join, an unpaid month. December is
 * computed on what the year ACTUALLY was: real gross, real BPJS, real PTKP, the Article 17
 * brackets, then minus what was already withheld.
 *
 * Biaya jabatan is capped MONTHLY by the regulation, so it is accumulated per month rather
 * than taken as 5% of the annual gross — for anyone above Rp 10.000.000/month those are
 * different numbers.
 *
 * Returns zero, never a negative: an employer cannot refund tax through payroll. An
 * over-withheld employee claims it on their annual filing, and `overWithheldIdr` is what
 * tells them (and the 1721-A1) how much.
 */
export function pph21December(
  input: StatutoryInput,
  ytd: Pph21YearToDate,
  decemberBpjsIdr: number,
  rates: StatutoryRates,
): Pph21DecemberResult {
  const zero = { monthlyIdr: 0, annualTaxIdr: 0, annualTaxableIdr: 0, overWithheldIdr: 0 };
  if (!input.ptkpStatus) return zero;

  const annualGross = ytd.grossIdr + input.grossIdr;
  const monthlyCost = (gross: number): number =>
    Math.min((gross * rates.occupationalCostPct) / 100, rates.occupationalCostCapIdr);
  // Prior months are averaged: the accumulator keeps their total, not each month's gross,
  // and the cap is monthly. Averaging is exact when pay did not vary and is the closest
  // honest figure when it did — the alternative is storing twelve rows to save one cap.
  const priorCost = ytd.months > 0 ? monthlyCost(ytd.grossIdr / ytd.months) * ytd.months : 0;
  const annualCost = priorCost + monthlyCost(input.grossIdr);

  const annualNet = annualGross - annualCost - (ytd.bpjsIdr + decemberBpjsIdr);
  const taxable = annualNet - PTKP_ANNUAL_IDR[input.ptkpStatus];
  if (taxable <= 0) {
    return { ...zero, overWithheldIdr: rupiah(ytd.withheldIdr) };
  }

  const rounded = Math.floor(taxable / 1000) * 1000;
  let annualTax = progressiveTax(rounded);
  if (!input.hasNpwp) annualTax *= 1 + rates.noNpwpSurchargePct / 100;

  const due = annualTax - ytd.withheldIdr;
  return {
    monthlyIdr: rupiah(Math.max(0, due)),
    annualTaxIdr: rupiah(annualTax),
    annualTaxableIdr: rounded,
    overWithheldIdr: rupiah(Math.max(0, -due)),
  };
}
