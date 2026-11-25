/**
 * HD-6 H5: the HR facts the AI read API aggregates. Counts and sums only: no row names an employee,
 * and `people` is how many distinct employees a figure rests on, so the reader can hold back a
 * figure resting on fewer than 3. Callers pass only the depots and the days they may read.
 */
export const AI_READ_REPOSITORY = Symbol('AiReadRepository');

/** The most groups one answer may rest on; past it the read is refused (422), never cut short. */
export const MAX_AI_READ_GROUPS = 50_000;

/** The attendance statuses the AI read API counts, in the order it answers them. */
export const ATTENDANCE_CELLS = [
  'present',
  'late',
  'absentRecorded',
  'leave',
  'pending',
  'scheduledDays',
  'attendedScheduled',
  'absentScheduled',
  'unscheduledDays',
] as const;
export type AttendanceCell = (typeof ATTENDANCE_CELLS)[number];

export interface AttendanceDepotRow {
  depotId: string;
  present: number;
  late: number;
  /** Explicit ABSENT records only: a scheduled day with no record at all is not counted here. */
  absentRecorded: number;
  leave: number;
  /** Punches taken offline and not yet decided by HR; counted as nothing. */
  pending: number;
  /**
   * Choice 35A. Employee-days on which the employee is scheduled to work (see domain/scheduled-days.ts:
   * the rule payroll uses), at the depot they worked that day, else their own depot.
   */
  scheduledDays: number;
  /** Scheduled days with a PRESENT or LATE record: the rate's numerator. */
  attendedScheduled: number;
  /** Scheduled days with no record, or an explicit ABSENT one: no punch and no leave. */
  absentScheduled: number;
  /** Employed workdays by the depot's weekly-off rule on which the employee has no shift of their own: left out of the rate. */
  unscheduledDays: number;
}

/**
 * The employees behind each count over the WHOLE window and every depot of the call, as opaque ids
 * (never a name): the reader unions them across calls, so one person with records at two depots is
 * one head, and holds back any count resting on fewer than 3.
 */
export type AttendanceHeads = Record<AttendanceCell, string[]>;

export interface PayrollDepotRow {
  depotId: string;
  /** APPROVED or PAID slips of the month, by the employee's own depot. */
  slips: number;
  grossIdr: number;
  bonusIdr: number;
  deductionIdr: number;
  netIdr: number;
  /** The daily gallon-target bonus lines inside bonusIdr. */
  gallonBonusIdr: number;
  /** Slips that carry a daily gallon-target bonus line: the people behind gallonBonusIdr. */
  gallonPeople: number;
}

export interface KasbonDepotRow {
  depotId: string;
  /** Employees who still owe on at least one active loan. */
  people: number;
  remainingIdr: number;
}

/**
 * Is a depot's month of payroll finished, on the HOME-depot basis the AI read API's payroll amounts
 * use? (The summary H2's money metrics gate on reads the live-depot basis, because the P&L and cash
 * flow amounts behind them do; each gate must share its amounts' basis.)
 */
export interface PayrollGateRow {
  depotId: string;
  /** Employees employed at any time in the month: joined by its last day, ACTIVE or left on or after its first. */
  expected: number;
  /** Slips still DRAFT. */
  draft: number;
  /** Employees with an APPROVED or PAID slip. */
  final: number;
}

export interface AiReadRepository {
  payrollGate(depotIds: readonly string[], month: string): Promise<PayrollGateRow[]>;
  /**
   * `from`..`to` are calendar days (`YYYY-MM-DD`, both included). `rolledUp`: some old days were
   * folded into monthly counts, so the window is incomplete.
   */
  attendance(
    depotIds: readonly string[],
    from: string,
    to: string,
  ): Promise<{ rows: AttendanceDepotRow[]; heads: AttendanceHeads; rolledUp: boolean }>;
  payroll(depotIds: readonly string[], month: string): Promise<PayrollDepotRow[]>;
  /** What is still owed through `month` on active loans, counting only APPROVED/PAID payslips. */
  kasbon(depotIds: readonly string[], month: string): Promise<KasbonDepotRow[]>;
}
