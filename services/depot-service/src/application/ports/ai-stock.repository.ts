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

/** One purchase order: RECEIVED (it set a price) or SENT (still expected). */
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
  /**
   * Negative ADJUSTMENT movements in `[from, to)`, WITHOUT the gallons lent with a delivery and the
   * reversals of rejected counts (filtered in the query, so a depot that lends a lot never hits the cap).
   */
  lossAdjustments(depotIds: readonly string[], from: Date, to: Date): Promise<MovementRow[]>;
  /** OPNAME movements in `[from, to)`. */
  opnameMovements(depotIds: readonly string[], from: Date, to: Date): Promise<MovementRow[]>;
  /** Opname variances HQ rejected, raised within `[from, to)` (plus a margin the caller sets). */
  rejectedOpnames(depotIds: readonly string[], from: Date, to: Date): Promise<RejectedOpnameRow[]>;
  /** Per depot, its newest RECEIVED orders received up to `asOf` (a bounded number: older prices are "no price"). */
  receivedPurchaseOrders(depotIds: readonly string[], asOf: Date): Promise<PurchaseOrderRow[]>;
  /** Orders SENT and not yet received. */
  sentPurchaseOrders(depotIds: readonly string[]): Promise<PurchaseOrderRow[]>;
  /** Gallons handed back damaged in `[from, to)`, one row per return. */
  damagedGallons(depotIds: readonly string[], from: Date, to: Date): Promise<{ depotId: string; quantity: number; createdAt: Date }[]>;
}

export const AI_STOCK_REPOSITORY = Symbol('AiStockRepository');
