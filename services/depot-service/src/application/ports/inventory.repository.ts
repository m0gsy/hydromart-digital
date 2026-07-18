import { InventoryItemType, ReservationStatus, StockMovementType } from '../../domain/inventory';

export interface InventoryItemRecord {
  id: string;
  depotId: string;
  itemType: InventoryItemType;
  productId: string | null;
  label: string;
  unit: string;
  quantity: number;
  reserved: number;
  minimumStock: number;
  /** Per-depot price override (PRODUK lines); null = use catalog base price. */
  sellPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A depot's price override for one product. */
export interface DepotProductPrice {
  productId: string;
  sellPrice: number;
}

export interface ReservationRecord {
  id: string;
  itemId: string;
  orderId: string;
  quantity: number;
  status: ReservationStatus;
}

export interface StockMovementRecord {
  id: string;
  itemId: string;
  type: StockMovementType;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  actorId: string;
  orderId: string | null;
  createdAt: Date;
}

export interface CreateInventoryItemData {
  depotId: string;
  itemType: InventoryItemType;
  productId: string | null;
  label: string;
  unit: string;
  quantity: number;
  minimumStock: number;
  sellPrice?: number | null;
}

export interface InventoryListFilter {
  itemType?: InventoryItemType;
  lowStockOnly?: boolean;
}

export interface UpdateInventoryItemData {
  label?: string;
  unit?: string;
  minimumStock?: number;
  sellPrice?: number | null;
}

export interface RecordMovementData {
  itemId: string;
  type: StockMovementType;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  actorId: string;
  /** Set only on SALE movements; keys idempotent order deduction. */
  orderId?: string | null;
}

export interface InventoryRepository {
  create(data: CreateInventoryItemData): Promise<InventoryItemRecord>;
  findById(id: string): Promise<InventoryItemRecord | null>;
  findLine(
    depotId: string,
    itemType: InventoryItemType,
    productId: string | null,
  ): Promise<InventoryItemRecord | null>;
  /**
   * Price overrides for the given products at a depot (PRODUK lines with a
   * non-null sellPrice). Products without an override are simply absent from the
   * result — the caller falls back to the catalog base price.
   */
  findPrices(depotId: string, productIds: string[]): Promise<DepotProductPrice[]>;
  listForDepot(depotId: string, filter: InventoryListFilter): Promise<InventoryItemRecord[]>;
  listLowStock(depotId?: string): Promise<InventoryItemRecord[]>;
  update(itemId: string, patch: UpdateInventoryItemData): Promise<InventoryItemRecord>;
  /**
   * Atomically set the new quantity and append the movement row. Returns the updated item.
   */
  applyMovement(
    itemId: string,
    newQuantity: number,
    movement: RecordMovementData,
  ): Promise<InventoryItemRecord>;
  /** True if a movement for this item already recorded the given order (SALE idempotency). */
  hasMovementForOrder(itemId: string, orderId: string): Promise<boolean>;
  listMovements(itemId: string): Promise<StockMovementRecord[]>;
  /**
   * Negative-delta ADJUSTMENT movements for a depot's lines in the window, each joined
   * with its line's label + sellPrice. Backs the depot wastage summary — the service
   * groups by item, sums the (absolute) lost quantity, and values it at sellPrice.
   */
  wastageAdjustments(
    depotId: string,
    range: { from?: Date; to?: Date },
  ): Promise<{ itemId: string; label: string; sellPrice: number | null; delta: number }[]>;

  /** The reservation this order holds on this line, if any (any status). */
  findReservation(itemId: string, orderId: string): Promise<ReservationRecord | null>;
  /**
   * Place ACTIVE holds on several lines for one order in a SINGLE serializable
   * transaction: each line is locked FOR UPDATE, availability re-checked under the
   * lock (closes the last-unit TOCTOU), then all-or-nothing — if any line is short,
   * nothing is written and its shortfall is returned; otherwise every line gets
   * `reserved += quantity` and a reservation row.
   */
  reserveAtomic(
    plans: { itemId: string; quantity: number }[],
    orderId: string,
  ): Promise<{ shortfalls: { itemId: string; requested: number; available: number }[] }>;
  /** Release an ACTIVE hold (cancel): status -> RELEASED, reserved -= quantity. Idempotent no-op otherwise. */
  releaseReservation(itemId: string, orderId: string): Promise<void>;
  /** Convert an ACTIVE hold on completion: status -> CONSUMED, reserved -= quantity. Idempotent no-op otherwise. */
  consumeReservation(itemId: string, orderId: string): Promise<void>;
}
