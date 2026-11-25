import { DepotTarget } from '../../domain/depot-target';

/** Identifying (depotId+month) + value fields for one target row (unique on [depotId, month]). */
export interface UpsertDepotTargetData {
  depotId: string;
  month: string;
  revenueTargetIdr: number;
  ordersTarget: number;
  slaTargetPct: number;
  newCustomersTarget: number;
  /** HD-16: gallons sold in the month (AI read metric G-01). 0 = no gallon target set. */
  /** Left out = keep what is stored (an older client that does not know the field); a new row starts at 0. */
  gallonsTarget?: number;
  updatedBy: string;
}

export interface DepotTargetRepository {
  /** The target for one depot+month, or null if none set yet. */
  findByDepotMonth(depotId: string, month: string): Promise<DepotTarget | null>;
  /** HD-16: the targets of one month for many depots (a depot without a row is simply absent). */
  findManyByMonth(depotIds: string[], month: string): Promise<DepotTarget[]>;
  /** Set (create or overwrite) the target for a depot+month. */
  upsert(data: UpsertDepotTargetData): Promise<DepotTarget>;
}
