import { Injectable } from '@nestjs/common';

import { InventoryItemType, StockMovementType } from '../../domain/inventory';
import {
  CreateInventoryItemData,
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  RecordMovementData,
  StockMovementRecord,
  UpdateInventoryItemData,
} from '../../application/ports/inventory.repository';
import { PrismaService } from './prisma.service';

interface ItemRow {
  id: string;
  depotId: string;
  itemType: string;
  productId: string | null;
  label: string;
  unit: string;
  quantity: number;
  minimumStock: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MovementRow {
  id: string;
  itemId: string;
  type: string;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  actorId: string;
  createdAt: Date;
}

@Injectable()
export class InventoryPrismaRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toItem(row: ItemRow): InventoryItemRecord {
    return { ...row, itemType: row.itemType as InventoryItemType };
  }

  private toMovement(row: MovementRow): StockMovementRecord {
    return { ...row, type: row.type as StockMovementType };
  }

  async create(data: CreateInventoryItemData): Promise<InventoryItemRecord> {
    const row = await this.prisma.inventoryItem.create({ data });
    return this.toItem(row);
  }

  async findById(id: string): Promise<InventoryItemRecord | null> {
    const row = await this.prisma.inventoryItem.findUnique({ where: { id } });
    return row ? this.toItem(row) : null;
  }

  async findLine(
    depotId: string,
    itemType: InventoryItemType,
    productId: string | null,
  ): Promise<InventoryItemRecord | null> {
    const row = await this.prisma.inventoryItem.findFirst({
      where: { depotId, itemType, productId },
    });
    return row ? this.toItem(row) : null;
  }

  async listForDepot(
    depotId: string,
    filter: InventoryListFilter,
  ): Promise<InventoryItemRecord[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { depotId, ...(filter.itemType ? { itemType: filter.itemType } : {}) },
      orderBy: [{ itemType: 'asc' }, { label: 'asc' }],
    });
    const items = rows.map((r) => this.toItem(r));
    // lowStockOnly is a computed predicate (minimum > 0 && qty <= minimum), not a column.
    return filter.lowStockOnly
      ? items.filter((i) => i.minimumStock > 0 && i.quantity <= i.minimumStock)
      : items;
  }

  async listLowStock(depotId?: string): Promise<InventoryItemRecord[]> {
    // quantity <= minimumStock isn't expressible as a plain where on two columns, so filter
    // the (already small) candidate set of lines that have a minimum set.
    const rows = await this.prisma.inventoryItem.findMany({
      where: { minimumStock: { gt: 0 }, ...(depotId ? { depotId } : {}) },
      orderBy: [{ depotId: 'asc' }, { itemType: 'asc' }],
    });
    return rows.map((r) => this.toItem(r)).filter((i) => i.quantity <= i.minimumStock);
  }

  async update(itemId: string, patch: UpdateInventoryItemData): Promise<InventoryItemRecord> {
    const row = await this.prisma.inventoryItem.update({ where: { id: itemId }, data: patch });
    return this.toItem(row);
  }

  async applyMovement(
    itemId: string,
    newQuantity: number,
    movement: RecordMovementData,
  ): Promise<InventoryItemRecord> {
    const [updated] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({
        where: { id: itemId },
        data: { quantity: newQuantity },
      }),
      this.prisma.stockMovement.create({ data: movement }),
    ]);
    return this.toItem(updated);
  }

  async listMovements(itemId: string): Promise<StockMovementRecord[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toMovement(r));
  }
}
