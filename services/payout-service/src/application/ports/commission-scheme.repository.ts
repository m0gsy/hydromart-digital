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
  /** Append one new scheme row per depot (bulk apply). */
  createMany(rows: CreateCommissionSchemeData[]): Promise<CommissionSchemeRecord[]>;
}
