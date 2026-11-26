/**
 * Laba bersih — the one profit formula (owner decision 2026-11-17):
 *
 *   omzet − HPP − gaji − komisi kurir − klaim biaya − refund
 *
 * It lives here because it is written four times with four different answers: the network
 * P&L, the depot P&L, the monthly review and the depot comparison each subtract their own set
 * of costs, so one depot's month has up to four "laba bersih". The network P&L is the first
 * caller; the other three move onto it next (flow plan PR-5a). Rent and electricity are absent
 * on purpose: nothing records them, and a profit that guesses at a cost cannot be argued with
 * line by line.
 *
 * Fail-closed: a term that could not be read is `null`, and then so is the profit. Reading an
 * unreachable payroll as zero would publish a month inflated by the whole wage bill, and it
 * would look exactly like a good month. A term that is not a finite number (a malformed
 * upstream answer) counts as unread too, so the screen says "—" rather than "NaN".
 */
export interface NetProfitTerms {
  /** Omzet: what customers were charged on orders that count as sales. */
  revenueIdr: number | null;
  /** HPP: cost of the goods sold. */
  cogsIdr: number | null;
  /** Gaji: the employer's wage cost (gross), not what reached the employee. */
  payrollIdr: number | null;
  courierCommissionIdr: number | null;
  expenseClaimIdr: number | null;
  /** Refunds on orders that still count as sales (a cancelled order's refund is not a cost twice). */
  refundIdr: number | null;
  /**
   * HD-16 (D22): the fixed costs HQ imported for the month (rent, electricity, ...). Optional, and
   * `null`/absent means NONE WERE ENTERED, so there is nothing to subtract and the profit is the
   * five-term one; the caller says so on screen ("belum diisi"). A caller that could not READ them
   * must not pass null: it reports the profit as unknown itself.
   */
  fixedCostIdr?: number | null;
}

const known = (term: number | null): term is number =>
  typeof term === 'number' && Number.isFinite(term);

export function netProfit(terms: NetProfitTerms): number | null {
  const costs = [
    terms.cogsIdr,
    terms.payrollIdr,
    terms.courierCommissionIdr,
    terms.expenseClaimIdr,
    terms.refundIdr,
  ];
  if (!known(terms.revenueIdr) || !costs.every(known)) return null;
  const fixed = terms.fixedCostIdr ?? 0;
  if (!known(fixed)) return null;
  return costs.reduce((net, cost) => net - cost, terms.revenueIdr) - fixed;
}
