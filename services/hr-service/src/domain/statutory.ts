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
// 2. The monthly PPh 21 figure here is the ANNUALISED PROGRESSIVE estimate (annualise the
//    month, subtract biaya jabatan, employee BPJS and PTKP, apply the UU HPP Article 17
//    brackets, divide by twelve) — not the TER table method PMK 168/2023 introduced for
//    monthly withholding from 2024. The two reach the same annual liability, which is what
//    the December reconciliation settles against; they differ month to month for someone
//    whose pay varies. This is a stated limitation, not an oversight: implementing TER
//    means shipping three bracket tables that must be exactly right, and a wrong table is
//    worse than a documented approximation. See ANNUAL_RECONCILIATION_TODO below.

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
 * Known gap, deliberately named rather than hidden: December's annual reconciliation
 * (PPh 21 terutang for the year minus what was already withheld) is not computed. It
 * needs year-to-date withholding per employee, which this service does not yet keep.
 * Until it does, an employee whose pay varied over the year will be a little over- or
 * under-withheld and the difference settles at their annual filing.
 */
export const ANNUAL_RECONCILIATION_TODO = true;

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
): Pph21Result {
  // No PTKP status on file means we cannot compute a lawful figure. Withholding an
  // invented amount from someone's pay is worse than withholding none: it takes money we
  // cannot justify. The gap surfaces as a missing payslip line, and employee.service
  // already captures ptkpStatus — this is a data-entry gap, not a silent zero.
  if (!input.ptkpStatus) return { monthlyIdr: 0, annualTaxableIdr: 0 };

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
): StatutoryDeduction[] {
  const bpjs = bpjsEmployeeDeductions(input, rates);
  const bpjsTotal = bpjs.reduce((sum, d) => sum + d.amountIdr, 0);
  const tax = pph21Monthly(input, bpjsTotal, rates);
  return tax.monthlyIdr > 0
    ? [...bpjs, { label: 'PPh 21', amountIdr: tax.monthlyIdr }]
    : bpjs;
}
