/**
 * HD-6 H5: the HR facts the AI read API aggregates. Counts and sums only: no row names an employee,
 * and `people` is how many distinct employees a figure rests on, so the reader can hold back a
 * figure resting on fewer than 3. Callers pass only the depots and the days they may read.
 */
export const AI_READ_REPOSITORY = Symbol('AiReadRepository');

/** The most groups one answer may rest on; past it the read is refused (422), never cut short. */
export const MAX_AI_READ_GROUPS = 50_000;

export interface AttendanceDepotRow {
  depotId: string;
  present: number;
  late: number;
  /** Explicit ABSENT records only: a scheduled day with no record at all is not counted here. */
  absent: number;
  leave: number;
  /** Punches taken offline and not yet decided by HR; counted as nothing. */
  pending: number;
  /** Distinct employees with a record at this depot in the window. */
  people: number;
}

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

export interface AiReadRepository {
  /**
   * `from`..`to` are calendar days (`YYYY-MM-DD`, both included). `rolledUp`: some old days were
   * folded into monthly counts, so the window is incomplete.
   */
  attendance(
    depotIds: readonly string[],
    from: string,
    to: string,
  ): Promise<{ rows: AttendanceDepotRow[]; rolledUp: boolean }>;
  payroll(depotIds: readonly string[], month: string): Promise<PayrollDepotRow[]>;
  /** What is still owed through `month` on active loans, counting only APPROVED/PAID payslips. */
  kasbon(depotIds: readonly string[], month: string): Promise<KasbonDepotRow[]>;
}
