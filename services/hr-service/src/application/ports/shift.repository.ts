import { Prisma, Shift, ShiftAssignment, ShiftRotation } from '../../../prisma/generated/client';

export const SHIFT_REPOSITORY = Symbol('SHIFT_REPOSITORY');

export interface ShiftWrite {
  depotId: string | null;
  name: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

export interface RotationWrite {
  name: string;
  depotId: string | null;
  pattern: Prisma.InputJsonValue;
  active: boolean;
}

export interface AssignmentWrite {
  employeeId: string;
  shiftId: string | null;
  rotationId: string | null;
  effectiveFrom: Date;
  note: string | null;
  createdBy: string | null;
}

export interface ShiftRepository {
  create(data: ShiftWrite): Promise<Shift>;
  update(id: string, data: Partial<ShiftWrite>): Promise<Shift>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Shift | null>;
  list(depotIds?: readonly string[]): Promise<Shift[]>;
  /** The active shift for a depot (its own, else a null-depot default), for late calc. */
  /** `null` = no home depot, so only a network-wide shift can match. */
  findActiveForDepot(depotId: string | null): Promise<Shift | null>;
  /**
   * How many things still point at this shift (B2).
   *
   * Three of them, because none is a foreign key in the schema:
   * `ShiftAssignment.shiftId` and `Employee.shiftId` are bare UUID columns, and a rotation
   * names shifts inside its `pattern` JSON. Deleting a shift they reference does not fail —
   * it leaves `shiftIdForDay` returning an id `findById` cannot resolve, and the clock-in
   * time silently drops to another rung of the precedence with nothing recorded anywhere.
   */
  countReferences(shiftId: string): Promise<number>;

  // ── rotations & assignments (C3) ──────────────────────────────────
  createRotation(data: RotationWrite): Promise<ShiftRotation>;
  updateRotation(id: string, data: Partial<RotationWrite>): Promise<ShiftRotation>;
  findRotationById(id: string): Promise<ShiftRotation | null>;
  listRotations(depotIds?: readonly string[]): Promise<ShiftRotation[]>;
  /** Append only — an assignment is never edited, a newer one supersedes it. */
  assign(data: AssignmentWrite): Promise<ShiftAssignment>;
  /**
   * Every assignment for an employee that had already started on `onDate`, oldest first.
   * The caller picks the one in force (domain/shift-rotation.ts) so the rule stays pure.
   */
  listAssignmentsUpTo(employeeId: string, onDate: Date): Promise<ShiftAssignment[]>;
  listAssignments(employeeId: string): Promise<ShiftAssignment[]>;
}
