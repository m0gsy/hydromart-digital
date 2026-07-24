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

export interface AttendanceRepository {
  findByEmployeeAndDate(employeeId: string, workDate: Date): Promise<Attendance | null>;
  create(input: CreateAttendanceInput): Promise<Attendance>;
  patchCheckOut(id: string, patch: CheckOutPatch): Promise<Attendance>;
  list(filter: AttendanceListFilter): Promise<{ rows: Attendance[]; total: number }>;
}
