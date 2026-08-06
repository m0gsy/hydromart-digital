import { CommissionSchemeRecord } from '../../domain/commission';

export interface CreateCommissionSchemeData {
  depotId: string;
  ownerName: string | null;
  pct: number;
  effectiveDate: Date;
}

export interface CommissionSchemeRepository {
  /** The current (latest effectiveDate) scheme for every depot that has one. */
  listCurrent(): Promise<CommissionSchemeRecord[]>;
  /**
   * The scheme in force for ONE depot, or null when it has none. Order completion used to
   * ask for every depot's current row and pick one out in JavaScript (audit S-15) — a read
   * of the whole commission table on every completed order.
   */
  currentForDepot(depotId: string): Promise<CommissionSchemeRecord | null>;
  /** Append one new scheme row per depot (bulk apply). */
  createMany(rows: CreateCommissionSchemeData[]): Promise<CommissionSchemeRecord[]>;
}
