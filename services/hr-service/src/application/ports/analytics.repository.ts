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

/**
 * CA-1-47: one document that is about to stop being valid, named well enough to act on.
 *
 * Nothing ever read `expiresAt`. HR typed the date on upload, the employee's own page
 * printed it back, and that was the end of it — a courier whose SIM lapsed kept driving
 * until a policeman noticed, because noticing was a per-employee errand nobody had a reason
 * to run.
 */
/**
 * CA-1-43: an employment that is about to run out.
 *
 * `contractEndDate` is written on every fixed-term hire and read by nothing. It is not a
 * status — nobody is expired automatically, by design — so a contract that lapsed last week
 * looks exactly like one with two years left, on every screen, and the first anyone notices
 * is when a courier without a valid contract is still driving.
 */
export interface EndingEmployment {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  employmentStatus: string;
  /** `YYYY-MM-DD`. Already past = the contract has run out. */
  contractEndDate: string;
}

export interface ExpiringDocument {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  type: string;
  /** `YYYY-MM-DD`. Already past = expired, and those come first. */
  expiresAt: string;
}

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

/** One depot's slice of the owner-dashboard summary, before it is shaped for the API. */
export interface DepotSummaryFacts {
  lateToday: number;
  absentToday: number;
  presentToday: number;
  payrollMtdNet: number;
  /**
   * CA-2-59: gross payroll — BASE + ALLOWANCE, before any deduction.
   *
   * The network P&L subtracts what the employer SPENDS on wages, and net is what lands in
   * the employee's account after BPJS, PPh 21, loan instalments and fines are withheld.
   * Treating net as the cost would book a lateness fine as a saving.
   */
  payrollMtdGross: number;
  activeHeadcount: number;
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
  /**
   * The three depot-summary reads, grouped BY depot in one query each, for the owner
   * dashboard's whole set of depots (audit S-1). Keyed by depot id; a depot with no rows
   * is absent from the map rather than zero-filled.
   */
  depotSummaryFacts(
    workDate: Date,
    periodMonth: string,
    depotIds: readonly string[],
  ): Promise<Map<string, DepotSummaryFacts>>;
  /** Payroll runs grouped by `status` for a period. */
  payrollByStatus(periodMonth: string, depotIds?: readonly string[]): Promise<GroupCount[]>;

  // --- report row fetchers ---
  /**
   * Current (not superseded) documents that expire on or before `cutoff`, soonest first.
   * Depot-scoped through the owning employee, and never returns anyone who has left.
   */
  expiringDocuments(cutoff: Date, depotIds?: readonly string[]): Promise<ExpiringDocument[]>;

  /**
   * Employments whose `contractEndDate` falls on or before `cutoff`, soonest first.
   * Depot-scoped, and never anyone who has already left.
   */
  endingEmployments(cutoff: Date, depotIds?: readonly string[]): Promise<EndingEmployment[]>;

  employeesForReport(depotIds?: readonly string[]): Promise<Employee[]>;
  /**
   * CA-1-62: the directory export answered 11 of the import template's 29 columns, so a
   * round trip — export, edit in Excel, re-import — could not carry an employee's payroll
   * identity back. `departmentId`/`shiftId` are plain uuid columns with no Prisma relation,
   * so the codes a human reads are resolved here rather than joined.
   */
  departmentCodesByIds(ids: readonly string[]): Promise<Map<string, string>>;
  shiftNamesByIds(ids: readonly string[]): Promise<Map<string, string>>;
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
  /** `depotIds` undefined = whole network (HQ); an array narrows to COMPANY-wide + those depots. */
  announcementsForReport(
    from: Date,
    to: Date,
    depotIds?: readonly string[],
  ): Promise<AnnouncementWithStats[]>;
}
