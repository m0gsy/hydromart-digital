import type { DepotMove } from '../../domain/depot-on';
import { DepotAssignmentKind, DepotAssignmentStatus, EmployeeDepotAssignment } from '../../../prisma/generated/client';

export const DEPOT_ASSIGNMENT_REPOSITORY = Symbol('DEPOT_ASSIGNMENT_REPOSITORY');

export interface DepotAssignmentWrite {
  employeeId: string;
  kind: DepotAssignmentKind;
  depotId: string;
  /** Local days (`YYYY-MM-DD`). */
  startDate: string;
  endDate: string | null;
  createdByRole: string | null;
  createdBy: string | null;
  note: string | null;
  /** Defaults to PLANNED; a manager's request is written as REQUESTED. */
  status?: DepotAssignmentStatus;
}

/** The statuses that still claim days on the calendar. */
export const OPEN_STATUSES: readonly DepotAssignmentStatus[] = ['PLANNED', 'ACTIVE'];

export interface DepotAssignmentListFilter {
  employeeId?: string;
  status?: DepotAssignmentStatus;
  /** Only rows this account created (a manager reading back their own requests). */
  createdBy?: string;
  /** Undefined for a reader above depots. Matches the destination depot OR the employee's home. */
  depotIds?: readonly string[];
  skip: number;
  take: number;
}

export interface DepotAssignmentRepository {
  /**
   * Insert one assignment, but only after `check` has seen every open assignment of that
   * employee - all inside one transaction that holds the employee's row lock. Two planners
   * racing on the same person therefore queue instead of both passing the overlap check
   * (there is no exclusion constraint: btree_gist is not installed, see the plan).
   *
   * `check` throws to refuse; whatever it throws reaches the caller unchanged.
   */
  createChecked(
    data: DepotAssignmentWrite,
    check: (open: EmployeeDepotAssignment[]) => void,
  ): Promise<EmployeeDepotAssignment>;
  findById(id: string): Promise<EmployeeDepotAssignment | null>;
  /**
   * The employee's whole depot ledger in `depotOn` shape: each LOAN_START carries the last day
   * of its assignment, so a sweep that never wrote LOAN_END cannot leave someone "on loan"
   * for ever. Ordered by `seq`.
   */
  timelineFor(employeeId: string): Promise<DepotMove[]>;
  /**
   * Whether the employee's depot ledger learned something that affects days up to `through`
   * after `since` - a loan backdated into the month, a sweep that applied late. A slip
   * generated before that holds a split the ledger no longer agrees with. Optional: a
   * repository that predates the guard simply does not offer it.
   */
  movedSince?(employeeId: string, since: Date, through: Date): Promise<boolean>;
  /** True when the employee has any PLANNED or ACTIVE assignment. */
  hasOpen(employeeId: string): Promise<boolean>;
  list(
    filter: DepotAssignmentListFilter,
  ): Promise<{ rows: EmployeeDepotAssignment[]; total: number }>;
  /**
   * What the sweep should act on today: PLANNED rows whose start day has come, and ACTIVE
   * loans whose last day is behind us. Oldest first, bounded.
   */
  findDue(today: string, limit: number): Promise<EmployeeDepotAssignment[]>;
  /**
   * One failed attempt. Past `maxAttempts` the row becomes FAILED with the reason, so it
   * stops being retried and a human can read why on the screen.
   */
  recordFailure(id: string, reason: string, maxAttempts: number): Promise<void>;
  /**
   * Decide a REQUESTED row: to PLANNED (after `check` has seen the employee's open assignments,
   * under the same row lock as `createChecked`) or to CANCELLED with the reason. Returns null
   * when the row was no longer REQUESTED - somebody decided first.
   */
  decideRequested?(
    id: string,
    to: 'PLANNED' | 'CANCELLED',
    check: ((open: EmployeeDepotAssignment[]) => void) | null,
    patch: { failReason?: string | null },
  ): Promise<EmployeeDepotAssignment | null>;
  /** PLANNED -> CANCELLED. Returns null when the row was no longer PLANNED. */
  cancelPlanned(id: string): Promise<EmployeeDepotAssignment | null>;
}
