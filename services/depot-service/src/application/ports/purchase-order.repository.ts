import { PoLine, PoStatus, PurchaseOrder } from '../../domain/purchase-order';

export interface CreatePurchaseOrderData {
  depotId: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  lines: PoLine[];
  subtotalIdr: number;
  shippingIdr: number;
  totalIdr: number;
  expectedAt: Date | null;
}

/** Partial patch: status transition and/or receivedAt stamp. */
export interface UpdatePurchaseOrderData {
  status?: PoStatus;
  receivedAt?: Date | null;
  /** CA-2-64: rewritten on a partial receipt, to carry each line's received quantity. */
  lines?: PoLine[];
}

export interface PurchaseOrderRepository {
  create(data: CreatePurchaseOrderData): Promise<PurchaseOrder>;
  /** A depot's POs, newest first; optionally filtered to one status. */
  listForDepot(depotId: string, status?: PoStatus): Promise<PurchaseOrder[]>;
  /**
   * Goods actually RECEIVED in [from, to) — the depot's goods cost for a period.
   *
   * By `receivedAt`, not `createdAt`: a PO raised in June and delivered in July is July's
   * stock.
   *
   * CA-2-55 changed what this has to count. It used to be a SQL `SUM(totalIdr)` — the full
   * ORDERED value — which was accidentally right only because a PO could not reach
   * RECEIVED until every line was full. Now a line can close short with a note, so the
   * ordered value overstates goods cost by exactly the shortfall, on the depot's own P&L.
   * It therefore sums what arrived: Σ(receivedOf(line) × unitCostIdr) + shipping.
   *
   * The old comment justified the SQL aggregate with "a busy depot's whole PO history is
   * not a bounded read". The read is bounded by depot AND one period — the same argument
   * `depot-costs.service.ts` already makes for the cash book beside it.
   */
  receivedTotalInRange(depotId: string, from: Date, to: Date): Promise<number>;
  findById(id: string): Promise<PurchaseOrder | null>;
  update(id: string, data: UpdatePurchaseOrderData): Promise<PurchaseOrder>;
}
