import { DepotTarget } from '../../domain/depot-target';

/** Identifying (depotId+month) + value fields for one target row (unique on [depotId, month]). */
export interface UpsertDepotTargetData {
  depotId: string;
  month: string;
  revenueTargetIdr: number;
  ordersTarget: number;
  slaTargetPct: number;
  newCustomersTarget: number;
  updatedBy: string;
}

export interface DepotTargetRepository {
  /** The target for one depot+month, or null if none set yet. */
  findByDepotMonth(depotId: string, month: string): Promise<DepotTarget | null>;
  /** Set (create or overwrite) the target for a depot+month. */
  upsert(data: UpsertDepotTargetData): Promise<DepotTarget>;
}
