import { Attendance, Employee, Payroll } from '../../../prisma/generated/client';

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

export interface AnalyticsRepository {
  /** Headcount grouped by employee `status` (ACTIVE/INACTIVE/RESIGNED), optional depot scope. */
  headcountByStatus(depotId?: string): Promise<GroupCount[]>;
  /** Active-employee headcount grouped by `employmentStatus`. */
  headcountByEmploymentStatus(depotId?: string): Promise<GroupCount[]>;
  /** Attendance rows for a single work date grouped by `status`. */
  attendanceByStatus(workDate: Date, depotId?: string): Promise<GroupCount[]>;
  /** Payroll money totals + run count for a period. */
  payrollTotals(periodMonth: string, depotId?: string): Promise<PayrollTotals>;
  /** Payroll runs grouped by `status` for a period. */
  payrollByStatus(periodMonth: string, depotId?: string): Promise<GroupCount[]>;

  // --- report row fetchers ---
  employeesForReport(depotId?: string): Promise<Employee[]>;
  attendanceForReport(from: Date, to: Date, depotId?: string): Promise<AttendanceWithEmployee[]>;
  payrollForReport(periodMonth: string, depotId?: string): Promise<PayrollWithEmployee[]>;
}
