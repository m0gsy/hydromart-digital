import { DepotFixedCost } from '../../domain/depot-fixed-cost';

export interface UpsertDepotFixedCostData {
  depotId: string;
  month: string;
  category: string;
  amountIdr: number;
  note: string | null;
  updatedBy: string;
}

export interface DepotFixedCostRepository {
  /** The row for one depot, month and category, or null. */
  find(depotId: string, month: string, category: string): Promise<DepotFixedCost | null>;
  /** Every row of one month, optionally one depot's, ordered by depot code then category. */
  listForMonth(month: string, depotId?: string): Promise<DepotFixedCost[]>;
  /** PR-A2: the amounts of one month for many depots (a depot without rows is absent). */
  totalsForDepots(month: string, depotIds: string[]): Promise<{ depotId: string; totalIdr: number }[]>;
  /** Create the row, or overwrite amount and note of the existing one. */
  upsert(data: UpsertDepotFixedCostData): Promise<void>;
}
