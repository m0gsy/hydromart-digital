import { GallonCondition } from '../../domain/gallon-return';

export interface GallonReturnRecord {
  id: string;
  depotId: string;
  customerId: string | null;
  quantity: number;
  condition: GallonCondition;
  depositRefunded: number;
  note: string | null;
  actorId: string;
  createdAt: Date;
}

export interface CreateGallonReturnData {
  depotId: string;
  customerId: string | null;
  quantity: number;
  condition: GallonCondition;
  depositRefunded: number;
  note: string | null;
  actorId: string;
}

/** Rollup of a depot's returns (all time): empties handed back + deposit refunded. */
export interface GallonReturnSummary {
  returns: number;
  gallons: number;
  damaged: number;
  depositRefunded: number;
}

/** One depot's all-time return totals (network rollup). */
export interface GallonReturnDepotRow {
  depotId: string;
  gallons: number;
  depositRefunded: number;
}

export interface GallonReturnRepository {
  create(data: CreateGallonReturnData): Promise<GallonReturnRecord>;
  listForDepot(depotId: string, page: number, limit: number): Promise<{ items: GallonReturnRecord[]; total: number }>;
  summaryForDepot(depotId: string): Promise<GallonReturnSummary>;
  /** Per-depot return totals across the network (SUM quantity, depositRefunded). */
  networkSummary(): Promise<GallonReturnDepotRow[]>;
}
