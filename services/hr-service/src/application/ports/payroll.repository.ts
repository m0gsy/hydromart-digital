import {
  Payroll,
  PayrollItem,
  PayrollItemKind,
  PayrollStatus,
} from '../../../prisma/generated/client';

export const PAYROLL_REPOSITORY = Symbol('PAYROLL_REPOSITORY');

export interface PayrollItemInput {
  kind: PayrollItemKind;
  label: string;
  amount: number;
  sourceRef?: string | null;
}

export interface PayrollWrite {
  employeeId: string;
  periodMonth: string;
  gross: number;
  totalBonus: number;
  totalDeduction: number;
  net: number;
  presentDays: number;
  createdBy: string | null;
  items: PayrollItemInput[];
}

export type PayrollWithItems = Payroll & { items: PayrollItem[] };

/**
 * PG-01 — a payslip with the name of the person it pays on it.
 *
 * A payroll row carries `employeeId` and nothing a human reads, so the approval queue was
 * forty rows of the same period and the same status, and the slip behind each one said
 * "Slip Gaji 2026-08 · 22 hari hadir · Rp 4.150.000" and named nobody. HR approved and
 * marked paid without ever seeing whose wage it was.
 */
export type PayrollWithEmployee = PayrollWithItems & { employeeName: string | null };
export type PayrollListRow = Payroll & { employeeName: string | null };

export interface PayrollRepository {
  findByEmployeeAndPeriod(
    employeeId: string,
    periodMonth: string,
  ): Promise<PayrollWithItems | null>;
  findById(id: string): Promise<PayrollWithItems | null>;
  /** Create a DRAFT payroll with its item lines (atomic). */
  create(data: PayrollWrite): Promise<PayrollWithItems>;
  /**
   * Replace a DRAFT payroll's fields + items in place (drop old lines first, atomic), and
   * only while it is still DRAFT (H-6) — a regenerate racing an approval must not rewrite
   * the numbers somebody just signed off.
   */
  regenerate(id: string, data: PayrollWrite): Promise<PayrollWithItems>;
  /**
   * Move status forward (APPROVED/PAID) with the actor + timestamp, from `from` only (H-6).
   *
   * approve, markPaid and regenerate all read the payroll, check its status, then write.
   * Run together they each passed a check none of them still held — an approval landing
   * after a payment stamped APPROVED over PAID, and the money was already out the door.
   */
  setStatus(
    id: string,
    from: PayrollStatus,
    status: PayrollStatus,
    stamp: { approvedBy?: string; approvedAt?: Date; paidAt?: Date },
  ): Promise<PayrollWithItems>;
  /**
   * IDR already deducted for each `sourceRef` on this employee's payslips BEFORE
   * `beforePeriodMonth` — the repayment ledger behind D4.
   *
   * A loan installment used to be derived purely from elapsed months, which assumes every
   * period collected in full. Once a period can collect less than the installment (net is
   * floored at 0), that assumption silently forgives the difference. This is what was
   * actually taken, so the remainder keeps being asked for.
   */
  deductedBySourceRefBefore(
    employeeId: string,
    beforePeriodMonth: string,
    sourceRefs: readonly string[],
  ): Promise<Map<string, number>>;
  /**
   * What this employee's EARLIER payslips in `year` already carried: gross, employee BPJS
   * and PPh 21 withheld, and how many months of them there were.
   *
   * December's reconciliation needs the year to date, and the year to date is already
   * written down — on the payslips themselves. A separate accumulator table would be the
   * same numbers twice, drifting the first time a payroll is regenerated.
   *
   * Only APPROVED and PAID payslips count. A DRAFT is a proposal; reconciling against
   * money that was never approved would withhold December against a number that may still
   * change.
   */
  pph21YearToDate(
    employeeId: string,
    year: number,
    beforePeriodMonth: string,
  ): Promise<{ grossIdr: number; bpjsIdr: number; withheldIdr: number; months: number }>;
  list(filter: {
    periodMonth?: string;
    employeeId?: string;
    status?: PayrollStatus;
    /** Depots the caller may see, via the owning employee. `undefined` = every depot (HQ). */
    depotIds?: readonly string[];
    skip: number;
    take: number;
    // PG-01: rows carry the name of the person they pay — see PayrollListRow.
  }): Promise<{ rows: PayrollListRow[]; total: number }>;
}
