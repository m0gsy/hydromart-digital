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
  SALE = 'SALE',
}

/** Lifecycle of a per-order stock hold: held at checkout, released on cancel, consumed on completion. */
export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  RELEASED = 'RELEASED',
  CONSUMED = 'CONSUMED',
}

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
