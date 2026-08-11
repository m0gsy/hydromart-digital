// Employee loan / kasbon repayment (Rule-G). Pure, no I/O. A loan is repaid in fixed
// monthly installments auto-deducted from payroll until the principal is cleared.
//
// The per-period deduction is a PURE function of (loan, period) — no mutable "remaining"
// column — so re-generating a DRAFT payroll is idempotent and never double-deducts.

export interface LoanTerms {
  principal: number;
  installmentAmount: number;
  /** First period the installment applies, "YYYY-MM". */
  startPeriod: string;
}

/** Absolute month index for ordering/subtracting "YYYY-MM" periods. */
export function periodIndex(period: string): number {
  const [y, m] = period.split('-').map(Number);
  return y * 12 + (m - 1);
}

/** Installments elapsed from startPeriod through `period` inclusive (0 before the loan starts). */
function installmentsElapsed(loan: LoanTerms, period: string): number {
  return Math.max(0, periodIndex(period) - periodIndex(loan.startPeriod) + 1);
}

/**
 * The IDR to deduct in `period` for this loan: a full installment, or the smaller final
 * stub that clears the balance, or 0 once fully paid / before it starts.
 *
 * `paidSoFar` is what earlier payslips ACTUALLY took (D4). Without it the function assumes
 * every elapsed month collected a full installment — true until a period could not afford
 * one, from which point the assumption quietly writes off the shortfall.
 */
export function loanDeductionFor(loan: LoanTerms, period: string, paidSoFar?: number): number {
  const n = installmentsElapsed(loan, period);
  if (n === 0 || loan.installmentAmount <= 0) return 0;
  const paidBefore = Math.min(loan.principal, paidSoFar ?? loan.installmentAmount * (n - 1));
  if (paidBefore >= loan.principal) return 0;
  return Math.max(0, Math.round(Math.min(loan.installmentAmount, loan.principal - paidBefore)));
}

/** Outstanding balance after `period`'s installment is applied. */
export function loanRemainingAfter(loan: LoanTerms, period: string): number {
  const n = installmentsElapsed(loan, period);
  const paid = Math.min(loan.principal, loan.installmentAmount * n);
  return Math.max(0, Math.round(loan.principal - paid));
}

/** True once the loan is fully repaid as of `period`. */
export function loanIsSettled(loan: LoanTerms, period: string): boolean {
  return loanRemainingAfter(loan, period) <= 0;
}
