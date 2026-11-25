// Depot-service domain vocabulary (PRD Module 9 Inventory + Module 10 Depot Management).
// Mirrors the Prisma enums; the domain never imports the generated client.

export enum OwnershipType {
  WARALABA = 'WARALABA',
  HKP = 'HKP',
}

export enum InventoryItemType {
  AIR = 'AIR',
  GALON = 'GALON',
  TUTUP = 'TUTUP',
  SEGEL = 'SEGEL',
  PRODUK = 'PRODUK',
}

export enum StockMovementType {
  RECEIPT = 'RECEIPT',
  ADJUSTMENT = 'ADJUSTMENT',
  OPNAME = 'OPNAME',
  /** CA-2-54: stock leaving for another depot, written when the sender dispatches. */
  TRANSFER_OUT = 'TRANSFER_OUT',
  /** CA-2-54: stock arriving from another depot, written when the receiver counts it. */
  TRANSFER_IN = 'TRANSFER_IN',
  SALE = 'SALE',
}

/** Lifecycle of a per-order stock hold: held at checkout, released on cancel, consumed on completion. */
export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  CONSUMED = 'CONSUMED',
}

export const MAX_STOCK_UNITS = 2_147_483_647;
export const MIN_STOCK_UNITS = -2_147_483_648;

/** Sellable stock = physical quantity minus units held by active reservations. */
export function available(quantity: number, reserved: number): number {
  return quantity - reserved;
}

/** PRODUK lines track a catalog product; the four raw types are per-depot singletons. */
export function isProductLine(type: InventoryItemType): boolean {
  return type === InventoryItemType.PRODUK;
}

/** A line is low when at or below its minimum (FR-074). Minimum 0 disables the alert. */
export function isLowStock(quantity: number, minimumStock: number): boolean {
  return minimumStock > 0 && quantity <= minimumStock;
}

/** HD-17B: the event a stock line crossing below its reorder point (minimumStock) raises. */
export const STOCK_LOW = 'stock.low';

/** The WIB calendar day (YYYY-MM-DD) of an instant: WIB is a fixed UTC+7, no DST. */
export function wibDay(at: Date): string {
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The outbox row for a low line. eventId carries the WIB day, so the outbox's unique key lets a
 * line raise at most one per day however often it crosses. No personal data: ids and counts.
 */
export function stockLowEvent(
  line: {
    id: string;
    depotId: string;
    productId: string | null;
    itemType: string;
    unit: string;
    minimumStock: number;
  },
  onHand: number,
  at: Date,
): { event: string; eventId: string; payload: Record<string, unknown>; occurredAt: Date } {
  return {
    event: STOCK_LOW,
    eventId: `${STOCK_LOW}:${line.depotId}:${line.id}:${wibDay(at)}`,
    payload: {
      depotId: line.depotId,
      itemId: line.id,
      itemType: line.itemType,
      productId: line.productId,
      onHand,
      reorderPoint: line.minimumStock,
      unit: line.unit,
      occurredAt: at.toISOString(),
    },
    occurredAt: at,
  };
}
