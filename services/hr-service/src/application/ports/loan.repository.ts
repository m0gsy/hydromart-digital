import { Loan } from '../../../prisma/generated/client';

export const LOAN_REPOSITORY = Symbol('LOAN_REPOSITORY');

export interface LoanWrite {
  employeeId: string;
  principal: number;
  installmentAmount: number;
  startPeriod: string;
  note: string | null;
  active: boolean;
  createdBy: string | null;
}

export interface LoanRepository {
  create(data: LoanWrite): Promise<Loan>;
  update(id: string, data: Partial<Pick<LoanWrite, 'active' | 'note'>>): Promise<Loan>;
  findById(id: string): Promise<Loan | null>;
  listByEmployee(employeeId: string): Promise<Loan[]>;
  /** Active loans for an employee (drives the auto payroll deduction). */
  listActiveByEmployee(employeeId: string): Promise<Loan[]>;
  /**
   * CA-1-34: every loan on the books, newest first.
   *
   * `/hr/loans/import` could put five hundred kasbon rows into the ledger in one paste, and
   * there was no screen anywhere that listed them — the only way to see a loan was to know
   * whose it was and open that employee. A bulk-import wizard with no list is a one-way
   * door: nobody could check what the paste actually did.
   *
   * Scoped by depot like every other HR list, and paged, because "all of them" on a real
   * roster is not a page.
   */
  listAll(filter: LoanListFilter): Promise<{ rows: LoanListRow[]; total: number }>;
}

export interface LoanListFilter {
  /** Undefined for a reader who sits above depots — they see the whole network. */
  depotIds?: readonly string[];
  /** Only loans still being deducted. Absent = both. */
  activeOnly?: boolean;
  skip: number;
  take: number;
}

/** A loan with the two things a list needs and the row itself does not carry. */
export type LoanListRow = Loan & { employeeName: string | null; employeeCode: string | null };
