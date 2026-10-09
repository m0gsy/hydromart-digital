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
}

/** The statuses that still claim days on the calendar. */
export const OPEN_STATUSES: readonly DepotAssignmentStatus[] = ['PLANNED', 'ACTIVE'];

export interface DepotAssignmentListFilter {
  employeeId?: string;
  status?: DepotAssignmentStatus;
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
  /** True when the employee has any PLANNED or ACTIVE assignment. */
  hasOpen(employeeId: string): Promise<boolean>;
  list(
    filter: DepotAssignmentListFilter,
  ): Promise<{ rows: EmployeeDepotAssignment[]; total: number }>;
  /** PLANNED -> CANCELLED. Returns null when the row was no longer PLANNED. */
  cancelPlanned(id: string): Promise<EmployeeDepotAssignment | null>;
}
