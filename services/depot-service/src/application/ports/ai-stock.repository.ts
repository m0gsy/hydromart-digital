import { InventoryItemType } from '../../domain/inventory';
import { PoLine } from '../../domain/purchase-order';

/** HD-6 H4: the stock facts the AI read API asks for. Every list is capped; past the cap the repo refuses, never cuts. */
export interface StockLineRow {
  depotId: string;
  itemType: InventoryItemType;
  quantity: number;
  reserved: number;
  minimumStock: number;
}

export interface MovementRow {
  id: string;
  itemId: string;
  depotId: string;
  itemType: InventoryItemType;
  productId: string | null;
  delta: number;
  reason: string | null;
  createdAt: Date;
}

export interface RejectedOpnameRow {
  depotId: string;
  createdAt: Date;
  itemId: string | null;
  variance: number | null;
}

/** One PO that has put goods on the shelf (or is still waiting for them). */
export interface PurchaseOrderRow {
  depotId: string;
  status: 'SENT' | 'RECEIVED';
  createdAt: Date;
  receivedAt: Date | null;
  lines: PoLine[];
}

export interface AiStockRepository {
  /** Visible (not hidden) stock lines of these depots. */
  stockLines(depotIds: readonly string[]): Promise<StockLineRow[]>;
  /** Negative ADJUSTMENT movements in `[from, to)`. */
  lossAdjustments(depotIds: readonly string[], from: Date, to: Date): Promise<MovementRow[]>;
  /** OPNAME movements in `[from, to)`. */
  opnameMovements(depotIds: readonly string[], from: Date, to: Date): Promise<MovementRow[]>;
  /** Opname variances HQ rejected, raised within `[from, to)` (plus a margin the caller sets). */
  rejectedOpnames(depotIds: readonly string[], from: Date, to: Date): Promise<RejectedOpnameRow[]>;
  /** POs created up to `asOf` that are SENT or RECEIVED, newest first. */
  purchaseOrders(depotIds: readonly string[], asOf: Date, statuses: ('SENT' | 'RECEIVED')[]): Promise<PurchaseOrderRow[]>;
  /** Gallons handed back damaged at one depot in `[from, to)`. */
  damagedGallons(depotId: string, from: Date, to: Date): Promise<number>;
}

export const AI_STOCK_REPOSITORY = Symbol('AiStockRepository');
