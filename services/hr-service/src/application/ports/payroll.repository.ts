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
  list(filter: {
    periodMonth?: string;
    employeeId?: string;
    status?: PayrollStatus;
    /** Depots the caller may see, via the owning employee. `undefined` = every depot (HQ). */
    depotIds?: readonly string[];
    skip: number;
    take: number;
  }): Promise<{ rows: Payroll[]; total: number }>;
}
