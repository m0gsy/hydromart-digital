import { Attendance, AttendanceStatus } from '../../../prisma/generated/client';

export const ATTENDANCE_REPOSITORY = Symbol('ATTENDANCE_REPOSITORY');

export interface CreateAttendanceInput {
  employeeId: string;
  /** Copied from the employee; null for staff who sit above any single depot. */
  depotId: string | null;
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

/**
 * CA-1-01: whose attendance this is.
 *
 * The approval queue drew a date, two times and a lateness figure, and no name anywhere —
 * an HR officer was approving or rejecting somebody's working day without being told
 * whose. `Payroll` (PG-01) and `LeaveRequest` (PG-06) had the same hole and closed it the
 * same way: one join on a relation the row already has.
 *
 * Null for an employee whose record was anonymised under the retention policy.
 */
export type AttendanceListRow = Attendance & { employeeName: string | null };

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
  /**
   * Days whose punch is still PENDING — synced late, or taken outside every geofence, and
   * not yet judged by HR (D2).
   *
   * Required, not optional: payroll derives absence by subtraction, so any status missing
   * from this summary silently becomes a no-show and gets fined. A new producer must say
   * what it counts rather than default to zero.
   */
  pendingDays: number;
}

/** One attended day's clocked minutes (M24-17 overtime input). */
export interface WorkedMinutesRow {
  workDate: Date;
  /** Null when the day was never checked out. */
  workingMinutes: number | null;
  /**
   * Minutes past the shift start this day's check-in was, measured from `workStartTime`
   * itself (not from the end of the tolerance window). 0 on a PRESENT day. Feeds the
   * tiered late fine — the flat one only ever needed a COUNT of late days.
   */
  lateMinutes: number;
}

export interface ManualAttendanceInput {
  employeeId: string;
  depotId: string | null;
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
   * The same counts for many employees in ONE query, keyed by employee id (audit S-6).
   * An employee with no attendance in the window is absent from the map, not zero-filled —
   * the caller decides what "no rows" means for it.
   */
  summaryMany(
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, AttendanceSummary>>;
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
  list(filter: AttendanceListFilter): Promise<{ rows: AttendanceListRow[]; total: number }>;
}
