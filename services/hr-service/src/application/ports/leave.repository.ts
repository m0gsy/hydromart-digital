import { LeaveBalance, LeaveRequest, LeaveStatus, LeaveType } from '../../../prisma/generated/client';

export const LEAVE_REPOSITORY = Symbol('LEAVE_REPOSITORY');

export interface LeaveRequestWrite {
  employeeId: string;
  depotId: string;
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

export interface LeaveListFilter {
  employeeId?: string;
  depotId?: string;
  status?: LeaveStatus;
  skip: number;
  take: number;
}

export interface LeaveRepository {
  create(data: LeaveRequestWrite): Promise<LeaveRequest>;
  findById(id: string): Promise<LeaveRequest | null>;
  decide(id: string, decision: LeaveDecision): Promise<LeaveRequest>;
  list(filter: LeaveListFilter): Promise<{ rows: LeaveRequest[]; total: number }>;
  /** Requests that still hold days for this employee, to reject an overlapping application. */
  listBlocking(employeeId: string, statuses: LeaveStatus[]): Promise<LeaveRequest[]>;
  findBalance(employeeId: string, year: number): Promise<LeaveBalance | null>;
  /** Create the year's row on first use with the configured quota. */
  ensureBalance(employeeId: string, year: number, quotaDays: number): Promise<LeaveBalance>;
  /** Move usedDays by a signed amount (approval adds; nothing subtracts today). */
  addUsedDays(employeeId: string, year: number, days: number): Promise<LeaveBalance>;
}
