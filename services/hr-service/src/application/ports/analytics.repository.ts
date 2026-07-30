import {
  Announcement,
  AnnouncementTarget,
  Attendance,
  Employee,
  EmployeeAsset,
  LeaveRequest,
  Payroll,
  PerformanceReview,
} from '../../../prisma/generated/client';

export const ANALYTICS_REPOSITORY = Symbol('ANALYTICS_REPOSITORY');

/** A grouped count, e.g. { key: 'ACTIVE', count: 42 }. */
export interface GroupCount {
  key: string;
  count: number;
}

export interface PayrollTotals {
  gross: number;
  totalBonus: number;
  totalDeduction: number;
  net: number;
  count: number;
}

export type AttendanceWithEmployee = Attendance & {
  employee: Pick<Employee, 'employeeCode' | 'fullName'>;
};
export type PayrollWithEmployee = Payroll & {
  employee: Pick<Employee, 'employeeCode' | 'fullName'>;
};
export type LeaveWithEmployee = LeaveRequest & {
  employee: Pick<Employee, 'employeeCode' | 'fullName'>;
};
export type ReviewWithEmployee = PerformanceReview & {
  employee: Pick<Employee, 'employeeCode' | 'fullName'>;
};
export type AssetWithHolder = EmployeeAsset & {
  holder: Pick<Employee, 'employeeCode' | 'fullName'> | null;
};
export type AnnouncementWithStats = Announcement & {
  targets: AnnouncementTarget[];
  _count: { reads: number };
};

export interface AnalyticsRepository {
  /** Headcount grouped by employee `status` (ACTIVE/INACTIVE/RESIGNED), optional depot scope. */
  headcountByStatus(depotIds?: readonly string[]): Promise<GroupCount[]>;
  /** Active-employee headcount grouped by `employmentStatus`. */
  headcountByEmploymentStatus(depotIds?: readonly string[]): Promise<GroupCount[]>;
  /** Attendance rows for a single work date grouped by `status`. */
  attendanceByStatus(workDate: Date, depotIds?: readonly string[]): Promise<GroupCount[]>;
  /** Payroll money totals + run count for a period. */
  payrollTotals(periodMonth: string, depotIds?: readonly string[]): Promise<PayrollTotals>;
  /** Payroll runs grouped by `status` for a period. */
  payrollByStatus(periodMonth: string, depotIds?: readonly string[]): Promise<GroupCount[]>;

  // --- report row fetchers ---
  employeesForReport(depotIds?: readonly string[]): Promise<Employee[]>;
  attendanceForReport(from: Date, to: Date, depotIds?: readonly string[]): Promise<AttendanceWithEmployee[]>;
  payrollForReport(periodMonth: string, depotIds?: readonly string[]): Promise<PayrollWithEmployee[]>;

  // --- C4 reports ---
  /** Only the days somebody actually arrived late; an absence is not a lateness. */
  lateForReport(from: Date, to: Date, depotIds?: readonly string[]): Promise<AttendanceWithEmployee[]>;
  /** Applications whose range OVERLAPS [from, to], not only those starting inside it. */
  leaveForReport(from: Date, to: Date, depotIds?: readonly string[]): Promise<LeaveWithEmployee[]>;
  performanceForReport(periodMonth: string, depotIds?: readonly string[]): Promise<ReviewWithEmployee[]>;
  assetsForReport(depotIds?: readonly string[]): Promise<AssetWithHolder[]>;
  /** Published announcements in the window, with the read count already aggregated. */
  announcementsForReport(from: Date, to: Date): Promise<AnnouncementWithStats[]>;
}
