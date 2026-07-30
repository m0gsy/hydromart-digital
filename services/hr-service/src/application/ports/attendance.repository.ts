import { Attendance, AttendanceStatus } from '../../../prisma/generated/client';

export const ATTENDANCE_REPOSITORY = Symbol('ATTENDANCE_REPOSITORY');

export interface CreateAttendanceInput {
  employeeId: string;
  depotId: string;
  workDate: Date;
  checkInAt: Date;
  checkInPhotoUrl: string | null;
  checkInScore: number;
  checkInLat: number;
  checkInLng: number;
  lateMinutes: number;
  status: AttendanceStatus;
}

export interface CheckOutPatch {
  checkOutAt: Date;
  checkOutPhotoUrl: string | null;
  checkOutScore: number;
  checkOutLat: number;
  checkOutLng: number;
  workingMinutes: number;
}

export interface AttendanceListFilter {
  depotIds?: readonly string[];
  employeeId?: string;
  status?: AttendanceStatus;
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

/** One attended day's clocked minutes (M24-17 overtime input). */
export interface WorkedMinutesRow {
  workDate: Date;
  /** Null when the day was never checked out. */
  workingMinutes: number | null;
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
  /**
   * Per-day worked minutes for [from, to] (M24-17). The payroll engine needs the DATES,
   * not just a total, because a day that fell on a weekly-off day or national holiday is
   * paid at a different overtime rate.
   */
  listWorkedMinutes(employeeId: string, from: Date, to: Date): Promise<WorkedMinutesRow[]>;
  create(input: CreateAttendanceInput): Promise<Attendance>;
  patchCheckOut(id: string, patch: CheckOutPatch): Promise<Attendance>;
  /** Settle a PENDING offline punch (HR approve/reject). */
  patchStatus(id: string, status: AttendanceStatus): Promise<Attendance>;
  list(filter: AttendanceListFilter): Promise<{ rows: Attendance[]; total: number }>;
}
