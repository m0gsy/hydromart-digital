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
   * Answer a request. `seenUpdatedAt` is checked by the service, not here — the repository
   * writes what it is told.
   */
  decide(id: string, decision: LoanRequestDecision): Promise<LoanRequest>;
}
