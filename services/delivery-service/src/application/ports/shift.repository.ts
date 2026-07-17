import { ShiftStatus } from '../../domain/shift';

export interface ShiftRecord {
  id: string;
  driverId: string;
  depotId: string;
  status: ShiftStatus;
  checkInAt: Date;
  checkInLat: number;
  checkInLng: number;
  expectedEndAt: Date;
  checkOutAt: Date | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  breakSecondsUsed: number;
  breakStartedAt: Date | null;
}

export interface OpenShiftData {
  driverId: string;
  depotId: string;
  checkInLat: number;
  checkInLng: number;
  /** Supplied by the service, not the DB default, so it and expectedEndAt come from
   * one clock — otherwise the shift length drifts by the app↔DB clock skew. */
  checkInAt: Date;
  expectedEndAt: Date;
}

/** Fields a status change may write. Absent keys are left untouched. */
export interface ShiftStatusPatch {
  status: ShiftStatus;
  breakStartedAt?: Date | null;
  breakSecondsUsed?: number;
  checkOutAt?: Date;
  checkOutLat?: number;
  checkOutLng?: number;
}

export interface ShiftQuery {
  depotId?: string;
  /** Shifts whose checkInAt falls on this UTC day. */
  from?: Date;
  to?: Date;
}

export interface ShiftRepository {
  open(data: OpenShiftData): Promise<ShiftRecord>;
  findById(id: string): Promise<ShiftRecord | null>;
  /** The driver's shift that has not been checked out, if any. At most one exists. */
  findOpenByDriver(driverId: string): Promise<ShiftRecord | null>;
  patchStatus(id: string, patch: ShiftStatusPatch): Promise<ShiftRecord>;
  /** Shift history for a driver, newest first. */
  listByDriver(driverId: string, limit: number): Promise<ShiftRecord[]>;
  /** Dispatch view: shifts at a depot in a window. */
  search(query: ShiftQuery): Promise<ShiftRecord[]>;
}
