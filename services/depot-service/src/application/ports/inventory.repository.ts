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
  createdAt: Date;
  updatedAt: Date;
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
}

export interface InventoryListFilter {
  itemType?: InventoryItemType;
  lowStockOnly?: boolean;
}

export interface UpdateInventoryItemData {
  label?: string;
  unit?: string;
  minimumStock?: number;
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

  /** The reservation this order holds on this line, if any (any status). */
  findReservation(itemId: string, orderId: string): Promise<ReservationRecord | null>;
  /** Atomically place an ACTIVE hold: reserved += quantity and insert the reservation row. */
  reserve(itemId: string, orderId: string, quantity: number): Promise<InventoryItemRecord>;
  /** Release an ACTIVE hold (cancel): status -> RELEASED, reserved -= quantity. Idempotent no-op otherwise. */
  releaseReservation(itemId: string, orderId: string): Promise<void>;
  /** Convert an ACTIVE hold on completion: status -> CONSUMED, reserved -= quantity. Idempotent no-op otherwise. */
  consumeReservation(itemId: string, orderId: string): Promise<void>;
}
