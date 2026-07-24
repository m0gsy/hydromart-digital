import { Shift } from '../../../prisma/generated/client';

export const SHIFT_REPOSITORY = Symbol('SHIFT_REPOSITORY');

export interface ShiftWrite {
  depotId: string | null;
  name: string;
  startTime: string;
  endTime: string;
  active: boolean;
}

export interface ShiftRepository {
  create(data: ShiftWrite): Promise<Shift>;
  update(id: string, data: Partial<ShiftWrite>): Promise<Shift>;
  delete(id: string): Promise<void>;
  findById(id: string): Promise<Shift | null>;
  list(depotId?: string): Promise<Shift[]>;
  /** The active shift for a depot (its own, else a null-depot default), for late calc. */
  findActiveForDepot(depotId: string): Promise<Shift | null>;
}
