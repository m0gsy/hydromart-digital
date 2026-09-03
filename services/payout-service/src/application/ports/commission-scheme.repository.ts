import { CommissionSchemeRecord } from '../../domain/commission';

export interface CreateCommissionSchemeData {
  depotId: string;
  ownerName: string | null;
  pct: number;
  effectiveDate: Date;
}

export interface CommissionSchemeRepository {
  /**
   * The scheme IN FORCE at `asOf` (default: now) for every depot that has one: the newest
   * row whose effective date has ARRIVED, not merely the newest row.
   *
   * `asOf` is a parameter rather than a `new Date()` inside the query so the boundary is
   * assertable at all — the defect this signature exists to close was invisible precisely
   * because nothing could ask "which scheme applies on a given day?".
   */
  listCurrent(asOf?: Date): Promise<CommissionSchemeRecord[]>;
  /**
   * The scheme in force for ONE depot at `asOf`, or null when it has none. Order completion
   * used to ask for every depot's current row and pick one out in JavaScript (audit S-15) —
   * a read of the whole commission table on every completed order.
   */
  currentForDepot(depotId: string, asOf?: Date): Promise<CommissionSchemeRecord | null>;
  /** Append one new scheme row per depot (bulk apply). */
  createMany(rows: CreateCommissionSchemeData[]): Promise<CommissionSchemeRecord[]>;
}
