import { InventoryItemType } from '../../domain/inventory';
import { PoLine } from '../../domain/purchase-order';

export interface OperationalReportRange {
  from: Date;
  to: Date;
}

export interface SaleCostInput {
  movementId: string;
  itemId: string;
  itemType: InventoryItemType;
  label: string;
  quantitySold: number;
  occurredAt: Date;
}

export interface ReceivedPurchaseOrderCostInput {
  id: string;
  poNumber: string;
  receivedAt: Date;
  lines: PoLine[];
}

export interface CashOutflowCostInput {
  id: string;
  category: string;
  amountIdr: number;
  sourceRef: string | null;
  occurredAt: Date;
}

export interface OperationalReportInputs {
  sales: SaleCostInput[];
  receivedPurchaseOrders: ReceivedPurchaseOrderCostInput[];
  outflows: CashOutflowCostInput[];
}

export interface OperationalReportRepository {
  load(depotId: string, range: OperationalReportRange): Promise<OperationalReportInputs>;
}
