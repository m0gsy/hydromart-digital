import { LoanRequest, LoanRequestStatus } from '../../../prisma/generated/client';

export const LOAN_REQUEST_REPOSITORY = Symbol('LOAN_REQUEST_REPOSITORY');

export interface LoanRequestWrite {
  employeeId: string;
  depotId: string;
  amount: number;
  reason: string;
}

export interface LoanRequestDecision {
  status: Extract<LoanRequestStatus, 'APPROVED' | 'REJECTED' | 'CANCELLED'>;
  decidedBy: string | null;
  decisionNote: string | null;
  loanId: string | null;
}

export interface LoanRequestListFilter {
  /** Undefined for a reader who sits above depots — they see the whole network. */
  depotIds?: readonly string[];
  status?: LoanRequestStatus;
  skip: number;
  take: number;
}

/** A request with the two things a queue needs and the row itself does not carry. */
export type LoanRequestListRow = LoanRequest & {
  employeeName: string | null;
  employeeCode: string | null;
};

/**
 * Kasbon somebody asked for, before it is money.
 *
 * Deliberately separate from `LoanRepository`: a `Loan` is a sum payroll is deducting, and
 * every one of its rows must carry a `startPeriod` the domain functions read without a
 * guard. A request has neither until somebody approves it.
 */
export interface LoanRequestRepository {
  /**
   * Raise a request. Rejects with Prisma P2002 when the person already has one open —
   * a PARTIAL unique index on (employeeId) WHERE status = 'PENDING' enforces it in the
   * database, so two tabs racing produce one row and one refusal rather than two requests.
   */
  create(data: LoanRequestWrite): Promise<LoanRequest>;
  findById(id: string): Promise<LoanRequest | null>;
  /** Everything this person ever asked for, newest first. */
  listByEmployee(employeeId: string): Promise<LoanRequest[]>;
  /** The decision queue, depot-scoped and paged like every other HR list. */
  listAll(filter: LoanRequestListFilter): Promise<{ rows: LoanRequestListRow[]; total: number }>;
  /**
   * Answer a request — but only while it is still PENDING; null when somebody else got there
   * first. `seenUpdatedAt` is checked by the service, not here.
   *
   * The PENDING guard is in the write itself. The service's own "is it pending" check is a
   * read, so two approvers (or a double click) both passed it, both created a loan, and the
   * employee was deducted twice; the second decide then overwrote `loanId`, orphaning the
   * first loan.
   */
  decide(id: string, decision: LoanRequestDecision): Promise<LoanRequest | null>;
  /** Links the loan an APPROVED request produced. */
  attachLoan(id: string, loanId: string): Promise<LoanRequest>;
  /**
   * Hands an approval whose loan could not be created back to PENDING, so it can be decided
   * again instead of sitting APPROVED with nothing behind it. If the employee has meanwhile
   * filed another request (one PENDING at a time), this one is cancelled instead.
   */
  reopen(id: string): Promise<void>;
}
