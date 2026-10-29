import {
  LeaveBalance,
  LeaveRequest,
  LeaveStatus,
  LeaveType,
} from '../../../prisma/generated/client';

export const LEAVE_REPOSITORY = Symbol('LEAVE_REPOSITORY');

export interface LeaveRequestWrite {
  employeeId: string;
  /** Copied from the employee; null routes the request to the HQ/HR queue only. */
  depotId: string | null;
  type: LeaveType;
  startDate: Date;
  endDate: Date;
  workingDays: number;
  reason: string;
  attachmentUrl: string | null;
}

export interface LeaveDecision {
  status: LeaveStatus;
  managerDecidedBy?: string;
  managerDecidedAt?: Date;
  hrDecidedBy?: string;
  hrDecidedAt?: Date;
  decisionNote?: string | null;
}

/** A queue row plus who it belongs to (PG-06). Null name = anonymised by retention. */
export type LeaveListRow = LeaveRequest & { employeeName: string | null };

export interface LeaveListFilter {
  employeeId?: string;
  depotIds?: readonly string[];
  status?: LeaveStatus;
  skip: number;
  take: number;
}

export interface LeaveRepository {
  create(data: LeaveRequestWrite): Promise<LeaveRequest>;
  findById(id: string): Promise<LeaveRequest | null>;
  /**
   * Moves a request out of `fromStatus` — and only if it is still there; null when somebody
   * else decided it first. The service's own status check is a read: two approvers both
   * passed it, both ran the settlement, and the quota was charged twice.
   */
  decide(id: string, fromStatus: LeaveStatus, decision: LeaveDecision): Promise<LeaveRequest | null>;
  /**
   * PG-06 — the approval queue, with the name of the person asking on every row.
   *
   * It carried `employeeId` and nothing a human reads: type, dates, reason, and two buttons
   * that grant or refuse somebody's leave. Same shape as PG-01 on the payroll queue, and the
   * same fix — the row already joins to the employee for its depot.
   */
  list(filter: LeaveListFilter): Promise<{ rows: LeaveListRow[]; total: number }>;
  /** Requests that still hold days for this employee, to reject an overlapping application. */
  listBlocking(employeeId: string, statuses: LeaveStatus[]): Promise<LeaveRequest[]>;
  findBalance(employeeId: string, year: number): Promise<LeaveBalance | null>;
  /** Create the year's row on first use with the configured quota. */
  ensureBalance(employeeId: string, year: number, quotaDays: number): Promise<LeaveBalance>;
  /**
   * Charge `days` against the year's quota, atomically: false when it would exceed
   * `quotaDays` (or there is no balance row), in which case nothing is charged.
   */
  claimUsedDays(employeeId: string, year: number, days: number): Promise<boolean>;
  /** Hand back days claimed for an approval that then lost the race. Never goes below zero. */
  releaseUsedDays(employeeId: string, year: number, days: number): Promise<void>;
  /**
   * Set the year's quota AND days already taken outright — the opening-balance import, which
   * is the one caller allowed to move usedDays to an arbitrary number (it is carrying over
   * leave that was taken in a system this one never saw).
   */
  setBalance(
    employeeId: string,
    year: number,
    quotaDays: number,
    usedDays: number,
  ): Promise<{ balance: LeaveBalance; existed: boolean }>;
}
