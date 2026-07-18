// Depot purchase orders (design 7a/9d). A PO is drafted, sent to a supplier, then received —
// receiving posts a RECEIPT stock movement per line into the depot's inventory.
// Mirrors the Prisma model; the domain never imports the generated client.

import { InventoryItemType } from './inventory';

export enum PoStatus {
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  RECEIVED = 'RECEIVED',
}

/** One ordered line: a stock type, its label, quantity, and unit cost (whole IDR). */
export interface PoLine {
  itemType: InventoryItemType;
  label: string;
  quantity: number;
  unitCostIdr: number;
}

export interface PurchaseOrder {
  id: string;
  depotId: string;
  poNumber: string;
  supplierId: string;
  /** Denormalized supplier name snapshot (list/detail without a join). */
  supplierName: string;
  status: PoStatus;
  lines: PoLine[];
  subtotalIdr: number;
  shippingIdr: number;
  totalIdr: number;
  expectedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

/** Pure: subtotal (Σ qty×unitCost) + shipping = total. Used at create time and in tests. */
export function computeTotal(
  lines: PoLine[],
  shippingIdr: number,
): { subtotalIdr: number; totalIdr: number } {
  const subtotalIdr = lines.reduce((sum, l) => sum + l.quantity * l.unitCostIdr, 0);
  return { subtotalIdr, totalIdr: subtotalIdr + shippingIdr };
}
