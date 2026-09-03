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
   * Total of the POs RECEIVED in [from, to) — the depot's goods cost for a period.
   *
   * By `receivedAt`, not `createdAt`: a PO raised in June and delivered in July is July's
   * stock. Aggregated in SQL because a busy depot's whole PO history is not a bounded read
   * and the caller only ever wants the one number.
   */
  receivedTotalInRange(depotId: string, from: Date, to: Date): Promise<number>;
  findById(id: string): Promise<PurchaseOrder | null>;
  update(id: string, data: UpdatePurchaseOrderData): Promise<PurchaseOrder>;
}
