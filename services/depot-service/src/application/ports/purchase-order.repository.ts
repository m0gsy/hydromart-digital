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
}

export interface PurchaseOrderRepository {
  create(data: CreatePurchaseOrderData): Promise<PurchaseOrder>;
  /** A depot's POs, newest first; optionally filtered to one status. */
  listForDepot(depotId: string, status?: PoStatus): Promise<PurchaseOrder[]>;
  findById(id: string): Promise<PurchaseOrder | null>;
  update(id: string, data: UpdatePurchaseOrderData): Promise<PurchaseOrder>;
}
