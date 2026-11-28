import { InstantRange } from './ai-money-sources.port';

/** depot-service: franchise applications submitted in a window, by the stage each is in now. */
export interface ApplicationSummary {
  total: number;
  byStage: Record<string, number>;
}

/** hr-service: one depot's attendance counts over a window of days. */
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

export interface AttendanceRow {
  depotId: string;
  present: number;
  late: number;
  /** Explicit ABSENT records only (any day), kept for continuity. */
  absentRecorded: number;
  leave: number;
  pending: number;
  /** Choice 35A: employee-days the shift data schedules (payroll's rule), at the depot worked that day else the own depot. */
  scheduledDays: number;
  /** Scheduled days with a PRESENT or LATE record: the rate's numerator. */
  attendedScheduled: number;
  /** Scheduled days with no record or an explicit ABSENT one: no punch and no leave. */
  absentScheduled: number;
  /** Employed workdays by the depot's weekly-off rule where the employee has no shift of their own: counted apart, not in the rate. */
  unscheduledDays: number;
}

/** Opaque employee ids behind each count over the whole call (never a name), unioned by the reader. */
export type AttendanceHeads = Record<AttendanceCell, string[]>;

/** Is a depot's month of payroll finished, on the employee HOME-depot basis the payroll amounts use. */
export interface PayrollGateRow {
  depotId: string;
  expected: number;
  draft: number;
  final: number;
}

/** hr-service: one depot's APPROVED/PAID payslips of a month, by the employee's own depot. */
export interface PayrollRow {
  depotId: string;
  slips: number;
  grossIdr: number;
  bonusIdr: number;
  deductionIdr: number;
  netIdr: number;
  gallonBonusIdr: number;
  gallonPeople: number;
}

export interface KasbonRow {
  depotId: string;
  people: number;
  remainingIdr: number;
}

/** hr-service: exits and opening and closing headcount of a month per depot (H-07). */
export interface TurnoverRow {
  depotId: string;
  exits: number;
  startHeadcount: number;
  endHeadcount: number;
}

/** depot-service: one depot's month targets (HD-16). 0 = not set, never a goal of zero. */
export interface DepotTargetRow {
  depotId: string;
  revenueTargetIdr: number;
  ordersTarget: number;
  newCustomersTarget: number;
  gallonsTarget: number;
}

/**
 * HD-6 H5: the franchise, legal-entity and HR facts the AI read API reads. Every method answers
 * `null` when its service cannot (down, refused, or an answer that is short of what was asked): the
 * metric then says belum_ada, never 0. Callers pass only the depots and days they may read, at most
 * 100 depots a call.
 */
export interface AiOrgSourcesPort {
  applications(range: InstantRange): Promise<ApplicationSummary | null>;
  /** The kind (FRANCHISOR, OPERATOR, FRANCHISEE) of each legal entity named; null if any is unknown. */
  entityKinds(ids: readonly string[]): Promise<Map<string, string> | null>;
  /** HQ's commission per depot over a window; one row per depot asked. */
  commission(depotIds: readonly string[], range: InstantRange): Promise<{ depotId: string; commissionIdr: number }[] | null>;
  attendance(depotIds: readonly string[], from: string, to: string): Promise<{ rows: AttendanceRow[]; heads: AttendanceHeads; rolledUp: boolean } | null>;
  payrollGate(depotIds: readonly string[], month: string): Promise<PayrollGateRow[] | null>;
  payroll(depotIds: readonly string[], month: string): Promise<PayrollRow[] | null>;
  kasbon(depotIds: readonly string[], month: string): Promise<KasbonRow[] | null>;
  /** H-07: exits and opening and closing headcount of the month (YYYY-MM), one row per depot asked. */
  turnover(depotIds: readonly string[], month: string): Promise<TurnoverRow[] | null>;
  /** HD-16: the month targets (YYYY-MM) of the depots named, one row each, in ONE read. */
  depotTargets(depotIds: readonly string[], month: string): Promise<DepotTargetRow[] | null>;
}
