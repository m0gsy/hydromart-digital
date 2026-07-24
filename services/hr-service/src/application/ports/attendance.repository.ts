import { Attendance, AttendanceStatus } from '../../../prisma/generated/client';

export const ATTENDANCE_REPOSITORY = Symbol('ATTENDANCE_REPOSITORY');

export interface CreateAttendanceInput {
  employeeId: string;
  depotId: string;
  workDate: Date;
  checkInAt: Date;
  checkInPhotoUrl: string | null;
  checkInScore: number;
  lateMinutes: number;
  status: AttendanceStatus;
}

export interface CheckOutPatch {
  checkOutAt: Date;
  checkOutPhotoUrl: string | null;
  checkOutScore: number;
  workingMinutes: number;
}

export interface AttendanceListFilter {
  depotId?: string;
  employeeId?: string;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

/** Aggregate attendance for a payroll period (present includes late; late is a subset). */
export interface AttendanceSummary {
  presentDays: number;
  lateDays: number;
  /** Days marked LEAVE (approved) — not counted as absent in payroll. */
  leaveDays: number;
}

export interface ManualAttendanceInput {
  employeeId: string;
  depotId: string;
  workDate: Date;
  status: AttendanceStatus;
  lateMinutes?: number;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
}

export interface AttendanceRepository {
  findByEmployeeAndDate(employeeId: string, workDate: Date): Promise<Attendance | null>;
  findById(id: string): Promise<Attendance | null>;
  /** Create-or-update the (employee, workDate) row from an HR manual entry/correction. */
  upsertManual(input: ManualAttendanceInput): Promise<Attendance>;
  /** Append an audit row for a manual attendance change (before/after snapshots). */
  recordAdjustment(data: {
    attendanceId: string;
    reason: string;
    before: unknown;
    after: unknown;
    approvedBy: string | null;
  }): Promise<void>;
  /** Present/late day counts for [from, to] (inclusive), used by the payroll engine. */
  summary(employeeId: string, from: Date, to: Date): Promise<AttendanceSummary>;
  create(input: CreateAttendanceInput): Promise<Attendance>;
  patchCheckOut(id: string, patch: CheckOutPatch): Promise<Attendance>;
  list(filter: AttendanceListFilter): Promise<{ rows: Attendance[]; total: number }>;
}
