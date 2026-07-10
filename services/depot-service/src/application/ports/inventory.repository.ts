import { InventoryItemType, StockMovementType } from '../../domain/inventory';

export interface InventoryItemRecord {
  id: string;
  depotId: string;
  itemType: InventoryItemType;
  productId: string | null;
  label: string;
  unit: string;
  quantity: number;
  minimumStock: number;
  createdAt: Date;
  updatedAt: Date;
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
  listMovements(itemId: string): Promise<StockMovementRecord[]>;
}
