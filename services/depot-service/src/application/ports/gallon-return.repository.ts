import type { GallonCustomerRow } from './gallon-issue.repository';
import { GallonCondition } from '../../domain/gallon-return';

export interface GallonReturnRecord {
  id: string;
  depotId: string;
  customerId: string | null;
  orderId: string | null;
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
  orderId: string | null;
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

/**
 * Empties handed back at one depot over a window, counted in GALLONS.
 *
 * Deliberately not `GallonReturnSummary`: that one's `damaged` is a ROW count (how many
 * return slips mentioned damage), which is the right answer for the returns list and the
 * wrong one for a report whose other columns are all gallons. `damaged` here is the
 * subset of `gallons`, not a separate bucket beside it.
 */
export interface GallonReturnRangeSummary {
  gallons: number;
  damaged: number;
}

/** One depot's all-time return totals (network rollup). */
export interface GallonReturnDepotRow {
  depotId: string;
  gallons: number;
  depositRefunded: number;
}

export interface GallonReturnRepository {
  create(data: CreateGallonReturnData): Promise<GallonReturnRecord>;
  listForDepot(
    depotId: string,
    page: number,
    limit: number,
  ): Promise<{ items: GallonReturnRecord[]; total: number }>;
  summaryForDepot(depotId: string): Promise<GallonReturnSummary>;
  /** Gallons returned at one depot in [from, to), with the damaged subset. */
  gallonsInRange(depotId: string, from: Date, to: Date): Promise<GallonReturnRangeSummary>;
  /** Per-depot return totals across the network (SUM quantity, depositRefunded). */
  networkSummary(): Promise<GallonReturnDepotRow[]>;
  /** Return totals per CUSTOMER at one depot (J-2); rows with no customer are excluded. */
  perCustomerForDepot(depotId: string): Promise<GallonCustomerRow[]>;
  /** One customer's most recent returns at one depot — the CRM detail deposit ledger. */
  listForCustomerAtDepot(
    depotId: string,
    customerId: string,
    limit: number,
  ): Promise<GallonReturnRecord[]>;
}
