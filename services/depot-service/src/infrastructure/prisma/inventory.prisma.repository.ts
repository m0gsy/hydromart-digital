import { Injectable } from '@nestjs/common';

import { available, InventoryItemType, ReservationStatus, StockMovementType } from '../../domain/inventory';
import {
  CreateInventoryItemData,
  DepotProductPrice,
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  RecordMovementData,
  ReservationRecord,
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
  reserved: number;
  minimumStock: number;
  sellPrice: unknown; // Prisma Decimal | null
  createdAt: Date;
  updatedAt: Date;
}

interface ReservationRow {
  id: string;
  itemId: string;
  orderId: string;
  quantity: number;
  status: string;
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
  orderId: string | null;
  createdAt: Date;
}

@Injectable()
export class InventoryPrismaRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toItem(row: ItemRow): InventoryItemRecord {
    return {
      ...row,
      itemType: row.itemType as InventoryItemType,
      sellPrice: row.sellPrice === null || row.sellPrice === undefined ? null : Number(row.sellPrice),
    };
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

  async findPrices(depotId: string, productIds: string[]): Promise<DepotProductPrice[]> {
    if (productIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.inventoryItem.findMany({
      where: {
        depotId,
        itemType: InventoryItemType.PRODUK,
        productId: { in: productIds },
        sellPrice: { not: null },
      },
      select: { productId: true, sellPrice: true },
    });
    return rows.map((r) => ({ productId: r.productId as string, sellPrice: Number(r.sellPrice) }));
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
    // lowStockOnly is a computed predicate on SELLABLE stock (min > 0 && available <= min),
    // not a column — reserved units don't count as fulfillable.
    return filter.lowStockOnly
      ? items.filter((i) => i.minimumStock > 0 && available(i.quantity, i.reserved) <= i.minimumStock)
      : items;
  }

  async listLowStock(depotId?: string): Promise<InventoryItemRecord[]> {
    // quantity <= minimumStock isn't expressible as a plain where on two columns, so filter
    // the (already small) candidate set of lines that have a minimum set.
    const rows = await this.prisma.inventoryItem.findMany({
      where: { minimumStock: { gt: 0 }, ...(depotId ? { depotId } : {}) },
      orderBy: [{ depotId: 'asc' }, { itemType: 'asc' }],
    });
    return rows
      .map((r) => this.toItem(r))
      .filter((i) => available(i.quantity, i.reserved) <= i.minimumStock);
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

  async hasMovementForOrder(itemId: string, orderId: string): Promise<boolean> {
    const row = await this.prisma.stockMovement.findFirst({
      where: { itemId, orderId },
      select: { id: true },
    });
    return row !== null;
  }

  async listMovements(itemId: string): Promise<StockMovementRecord[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toMovement(r));
  }

  private toReservation(row: ReservationRow): ReservationRecord {
    return { ...row, status: row.status as ReservationStatus };
  }

  async findReservation(itemId: string, orderId: string): Promise<ReservationRecord | null> {
    const row = await this.prisma.stockReservation.findUnique({
      where: { itemId_orderId: { itemId, orderId } },
    });
    return row ? this.toReservation(row) : null;
  }

  async reserveAtomic(
    plans: { itemId: string; quantity: number }[],
    orderId: string,
  ): Promise<{ shortfalls: { itemId: string; requested: number; available: number }[] }> {
    if (plans.length === 0) return { shortfalls: [] };
    // Deterministic lock order (by itemId) prevents deadlocks between concurrent orders.
    const ordered = [...plans].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
    return this.prisma.$transaction(async (tx) => {
      const shortfalls: { itemId: string; requested: number; available: number }[] = [];
      for (const p of ordered) {
        // Row lock: a concurrent reserve on the same line blocks here until we commit,
        // then re-reads the updated `reserved` — so the last unit can't be double-sold.
        const rows = await tx.$queryRaw<{ quantity: number; reserved: number }[]>`
          SELECT "quantity", "reserved" FROM "inventory_items" WHERE "id" = ${p.itemId}::uuid FOR UPDATE`;
        const sellable = rows.length ? available(Number(rows[0].quantity), Number(rows[0].reserved)) : 0;
        if (sellable < p.quantity) {
          shortfalls.push({ itemId: p.itemId, requested: p.quantity, available: sellable });
        }
      }
      if (shortfalls.length > 0) return { shortfalls }; // nothing written → clean rollback of a read-only txn
      for (const p of ordered) {
        await tx.inventoryItem.update({
          where: { id: p.itemId },
          data: { reserved: { increment: p.quantity } },
        });
        await tx.stockReservation.create({ data: { itemId: p.itemId, orderId, quantity: p.quantity } });
      }
      return { shortfalls: [] };
    });
  }

  /** Flip an ACTIVE reservation to a terminal status and give back its held units. */
  private async settleReservation(
    itemId: string,
    orderId: string,
    status: ReservationStatus.RELEASED | ReservationStatus.CONSUMED,
  ): Promise<void> {
    const res = await this.prisma.stockReservation.findUnique({
      where: { itemId_orderId: { itemId, orderId } },
    });
    if (!res || res.status !== ReservationStatus.ACTIVE) {
      return; // idempotent: nothing to settle
    }
    await this.prisma.$transaction([
      this.prisma.stockReservation.update({ where: { id: res.id }, data: { status } }),
      this.prisma.inventoryItem.update({
        where: { id: itemId },
        data: { reserved: { decrement: res.quantity } },
      }),
    ]);
  }

  async releaseReservation(itemId: string, orderId: string): Promise<void> {
    await this.settleReservation(itemId, orderId, ReservationStatus.RELEASED);
  }

  async consumeReservation(itemId: string, orderId: string): Promise<void> {
    await this.settleReservation(itemId, orderId, ReservationStatus.CONSUMED);
  }
}
