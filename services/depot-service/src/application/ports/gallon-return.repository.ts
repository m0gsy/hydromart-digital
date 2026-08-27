import type {
  GallonCustomerBalance,
  GallonCustomerRow,
  GallonDepotBalance,
} from './gallon-issue.repository';
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

/**
 * MONEY-04: one courier handover, booked from the order that carried it. `orderId` is
 * required here — that is the whole difference from `CreateGallonReturnData`, whose
 * `orderId` is nullable because a walk-in counter return has no order.
 */
export interface CreateGallonReturnFromOrderData extends CreateGallonReturnData {
  orderId: string;
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
  /**
   * MONEY-04: idempotent on `orderId`, the exact mirror of
   * `GallonIssueRepository.createFromOrder` — and it exists for the same reason, which the
   * issue side had and this one did not.
   *
   * The courier's handover goes through the offline queue (`kind: 'gallonReturn'`). That
   * queue is at-least-once by construction: a POST whose response is lost — a 15s timeout
   * at a customer's door, a 502 mid-deploy — is retried on the next flush. The old path was
   * a bare `create`, so the retry wrote a SECOND row and the deposit came back twice.
   *
   * `created` is what the caller needs to know: on a repeat there must be no second
   * variance approval and no second damaged-refund approval either. The record returned is
   * the first one, so the courier sees the refund that was actually booked.
   */
  createFromOrder(
    data: CreateGallonReturnFromOrderData,
  ): Promise<{ record: GallonReturnRecord; created: boolean }>;
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
  /** I2: one customer's returned gallons and refunded deposit at one depot. */
  summaryForCustomerAtDepot(depotId: string, customerId: string): Promise<GallonCustomerBalance>;
  /** I5: one customer's returned gallons and refunded deposit, per depot. */
  perDepotForCustomer(customerId: string): Promise<GallonDepotBalance[]>;
  /** One customer's most recent returns at one depot — the CRM detail deposit ledger. */
  listForCustomerAtDepot(
    depotId: string,
    customerId: string,
    limit: number,
  ): Promise<GallonReturnRecord[]>;
}
