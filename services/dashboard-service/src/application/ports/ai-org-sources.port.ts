import { InstantRange } from './ai-money-sources.port';

/** depot-service: franchise applications submitted in a window, by the stage each is in now. */
export interface ApplicationSummary {
  total: number;
  byStage: Record<string, number>;
}

/** hr-service: one depot's attendance counts over a window of days. */
export const ATTENDANCE_CELLS = ['present', 'late', 'absentRecorded', 'leave', 'pending'] as const;
export type AttendanceCell = (typeof ATTENDANCE_CELLS)[number];

export interface AttendanceRow {
  depotId: string;
  present: number;
  late: number;
  /** Explicit ABSENT records only; a scheduled day with no record is not visible. */
  absentRecorded: number;
  leave: number;
  pending: number;
  /** Distinct employees behind EACH count, so each can be held back on its own. */
  people: Record<AttendanceCell, number>;
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
  attendance(depotIds: readonly string[], from: string, to: string): Promise<{ rows: AttendanceRow[]; rolledUp: boolean } | null>;
  payroll(depotIds: readonly string[], month: string): Promise<PayrollRow[] | null>;
  kasbon(depotIds: readonly string[], month: string): Promise<KasbonRow[] | null>;
}
