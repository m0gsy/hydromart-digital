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
}

/** PRODUK lines track a catalog product; the four raw types are per-depot singletons. */
export function isProductLine(type: InventoryItemType): boolean {
  return type === InventoryItemType.PRODUK;
}

/** A line is low when at or below its minimum (FR-074). Minimum 0 disables the alert. */
export function isLowStock(quantity: number, minimumStock: number): boolean {
  return minimumStock > 0 && quantity <= minimumStock;
}
