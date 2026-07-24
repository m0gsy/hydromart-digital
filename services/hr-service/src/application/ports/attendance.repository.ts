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

export interface AttendanceRepository {
  findByEmployeeAndDate(employeeId: string, workDate: Date): Promise<Attendance | null>;
  /** Present/late day counts for [from, to] (inclusive), used by the payroll engine. */
  summary(employeeId: string, from: Date, to: Date): Promise<AttendanceSummary>;
  create(input: CreateAttendanceInput): Promise<Attendance>;
  patchCheckOut(id: string, patch: CheckOutPatch): Promise<Attendance>;
  list(filter: AttendanceListFilter): Promise<{ rows: Attendance[]; total: number }>;
}
