import { Injectable } from '@nestjs/common';
import { nextCursor, pageArgs } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';

import {
  available,
  InventoryItemType,
  ReservationStatus,
  StockMovementType,
} from '../../domain/inventory';
import {
  CreateInventoryItemData,
  DepotMovementFilter,
  DepotProductPrice,
  DepotStockMovementRecord,
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  RecordMovementData,
  ReservationRecord,
  StockMovementRecord,
  UpdateInventoryItemData,
} from '../../application/ports/inventory.repository';
import { NegativeStockError } from '../../domain/errors';
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
  hidden: boolean;
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

interface DepotMovementRow extends MovementRow {
  item: { label: string; itemType: string };
}

@Injectable()
export class InventoryPrismaRepository implements InventoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toItem(row: ItemRow): InventoryItemRecord {
    return {
      ...row,
      itemType: row.itemType as InventoryItemType,
      sellPrice:
        row.sellPrice === null || row.sellPrice === undefined ? null : Number(row.sellPrice),
    };
  }

  private toMovement(row: MovementRow): StockMovementRecord {
    return { ...row, type: row.type as StockMovementType };
  }

  async renameByProductId(productId: string, label: string, unit: string): Promise<number> {
    const { count } = await this.prisma.inventoryItem.updateMany({
      where: { productId },
      data: { label, unit },
    });
    return count;
  }

  async deleteLine(itemId: string): Promise<void> {
    // Movements and reservations cascade (schema onDelete: Cascade). The service only
    // ever calls this for a line that never sold anything, so no sales history is lost.
    await this.prisma.inventoryItem.delete({ where: { id: itemId } });
  }

  async listReservations(itemId: string): Promise<ReservationRecord[]> {
    const rows = await this.prisma.stockReservation.findMany({
      where: { itemId, status: ReservationStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toReservation(r as ReservationRow));
  }

  async setHiddenByProductId(productId: string, hidden: boolean): Promise<number> {
    const { count } = await this.prisma.inventoryItem.updateMany({
      where: { productId },
      data: { hidden },
    });
    return count;
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

  async listForDepot(depotId: string, filter: InventoryListFilter): Promise<InventoryItemRecord[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      // Hidden lines are excluded here and here only: this is the operator's list. Every
      // internal lookup (findLine, findById) still sees them, so an order placed before
      // the product was switched off can still be reserved, consumed and settled.
      where: { depotId, hidden: false, ...(filter.itemType ? { itemType: filter.itemType } : {}) },
      orderBy: [{ itemType: 'asc' }, { label: 'asc' }],
    });
    const items = rows.map((r) => this.toItem(r));
    // lowStockOnly is a computed predicate on SELLABLE stock (min > 0 && available <= min),
    // not a column — reserved units don't count as fulfillable.
    return filter.lowStockOnly
      ? items.filter(
          (i) => i.minimumStock > 0 && available(i.quantity, i.reserved) <= i.minimumStock,
        )
      : items;
  }

  /**
   * Low stock across one depot, several, or the whole network.
   *
   * The comparison is `quantity - reserved <= minimumStock`, which Prisma cannot express
   * as a where on two columns — so this used to read EVERY line with a minimum set, for
   * every depot, and filter them in JavaScript (audit S-13). Postgres does the comparison
   * now, which also means the row bound cannot silently drop a depot that is out of
   * stock: only the lines that are actually low come back.
   */
  async listLowStock(depotIds?: string | readonly string[]): Promise<InventoryItemRecord[]> {
    const ids =
      typeof depotIds === 'string' ? [depotIds] : depotIds ? [...depotIds] : undefined;
    if (ids && ids.length === 0) return [];
    const scope = ids
      ? Prisma.sql`AND "depotId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<ItemRow[]>(Prisma.sql`
      SELECT * FROM "inventory_items"
      WHERE "minimumStock" > 0
        AND ("quantity" - "reserved") <= "minimumStock"
        ${scope}
      ORDER BY "depotId" ASC, "itemType" ASC
    `);
    return rows.map((r) => this.toItem(r));
  }

  async update(itemId: string, patch: UpdateInventoryItemData): Promise<InventoryItemRecord> {
    const row = await this.prisma.inventoryItem.update({ where: { id: itemId }, data: patch });
    return this.toItem(row);
  }

  /**
   * One statement decides the new quantity, and Postgres decides the order.
   *
   * This used to read the line in the service, add the delta in Node, and write the
   * ABSOLUTE result back (audit CA-2-21). Two people adjusting the same line inside the
   * same few milliseconds both read the same "before", and the second write silently
   * erased the first: the movement ledger showed both corrections, the shelf count showed
   * one of them. Nothing reported it — the numbers simply stopped agreeing with the shelf.
   *
   * The write is now relative (`quantity + delta`) under the row lock the UPDATE itself
   * takes, and the floor is in the WHERE rather than in a Node `if`, so a concurrent sale
   * can no longer sneak a line below zero between the check and the write. `quantityBefore`
   * / `quantityAfter` come from the row the statement returned, not from the caller's stale
   * read, so the ledger records what actually happened rather than what was expected to.
   */
  async applyMovement(
    itemId: string,
    movement: RecordMovementData,
  ): Promise<InventoryItemRecord> {
    /*
     * The floor is NOT universal, and that distinction is the whole of it.
     *
     * A SALE records reality: the gallon left the shelf, and refusing to write it does not
     * put it back — it just makes the count disagree with the world and hides the disagreement.
     * depot-service has always allowed a sale to take a line negative for exactly that reason.
     *
     * Every other movement is somebody TYPING a number, and those are the ones a concurrent
     * sale can sneak underneath: the service pre-checks the floor against a read, and without
     * this clause the write could still land below zero in the gap between the two.
     */
    const floored = movement.type !== StockMovementType.SALE;
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ItemRow[]>(Prisma.sql`
        UPDATE "inventory_items"
           SET "quantity" = "quantity" + ${movement.delta}, "updatedAt" = NOW()
         WHERE "id" = ${itemId}::uuid
           ${floored ? Prisma.sql`AND "quantity" + ${movement.delta} >= 0` : Prisma.empty}
        RETURNING *
      `);
      const row = rows[0];
      if (!row) {
        // No row matched: either the line is gone, or the delta would take it below zero.
        // The service's own pre-check catches the ordinary case; this is the one only a
        // concurrent write can open, and it fails the movement instead of writing a
        // quantity nobody can explain.
        throw new NegativeStockError();
      }
      await tx.stockMovement.create({
        data: {
          ...movement,
          quantityBefore: row.quantity - movement.delta,
          quantityAfter: row.quantity,
        },
      });
      return this.toItem(row);
    });
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

  async findLines(
    depotId: string,
    itemType: InventoryItemType,
    productIds: string[],
  ): Promise<InventoryItemRecord[]> {
    if (productIds.length === 0) return [];
    const rows = await this.prisma.inventoryItem.findMany({
      where: { depotId, itemType, productId: { in: productIds } },
    });
    return rows.map((r) => this.toItem(r));
  }

  async itemsWithMovementForOrder(orderId: string, itemIds: string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await this.prisma.stockMovement.findMany({
      where: { orderId, itemId: { in: itemIds } },
      select: { itemId: true },
      distinct: ['itemId'],
    });
    return new Set(rows.map((r) => r.itemId));
  }

  async countMovements(itemId: string, type: StockMovementType): Promise<number> {
    return this.prisma.stockMovement.count({ where: { itemId, type } });
  }

  async listForDepotMovements(
    depotId: string,
    filter: DepotMovementFilter,
  ): Promise<{ items: DepotStockMovementRecord[]; total: number; nextCursor: string | null }> {
    const createdAt =
      filter.from || filter.to
        ? { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) }
        : undefined;
    const where = {
      item: { depotId },
      ...(filter.type ? { type: filter.type } : {}),
      ...(createdAt ? { createdAt } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        select: {
          id: true,
          itemId: true,
          type: true,
          delta: true,
          quantityBefore: true,
          quantityAfter: true,
          reason: true,
          actorId: true,
          orderId: true,
          createdAt: true,
          item: { select: { label: true, itemType: true } },
        },
        // `id` last so the cursor is unambiguous between movements in the same tick.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(filter),
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return {
      nextCursor: nextCursor(rows as { id: string }[], filter.limit),
      items: (rows as DepotMovementRow[]).map(({ item, ...row }) => ({
        ...this.toMovement(row),
        itemLabel: item.label,
        itemType: item.itemType as InventoryItemType,
      })),
      total,
    };
  }

  async wastageAdjustments(
    depotId: string,
    range: { from?: Date; to?: Date },
  ): Promise<{ itemId: string; label: string; sellPrice: number | null; delta: number }[]> {
    const createdAt =
      range.from || range.to
        ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) }
        : undefined;
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        type: StockMovementType.ADJUSTMENT,
        delta: { lt: 0 },
        item: { depotId },
        ...(createdAt ? { createdAt } : {}),
      },
      select: { itemId: true, delta: true, item: { select: { label: true, sellPrice: true } } },
    });
    return rows.map((r) => ({
      itemId: r.itemId,
      label: r.item.label,
      sellPrice:
        r.item.sellPrice === null || r.item.sellPrice === undefined
          ? null
          : Number(r.item.sellPrice),
      delta: r.delta,
    }));
  }

  async opnameVariances(
    depotId: string,
    range: { from?: Date; to?: Date },
  ): Promise<{ sellPrice: number | null; delta: number }[]> {
    const createdAt =
      range.from || range.to
        ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) }
        : undefined;
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        type: StockMovementType.OPNAME,
        item: { depotId },
        ...(createdAt ? { createdAt } : {}),
      },
      select: { delta: true, item: { select: { sellPrice: true } } },
    });
    return rows.map((r) => ({
      sellPrice:
        r.item.sellPrice === null || r.item.sellPrice === undefined
          ? null
          : Number(r.item.sellPrice),
      delta: r.delta,
    }));
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
    const ordered = [...plans].sort((a, b) =>
      a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0,
    );
    return this.prisma.$transaction(async (tx) => {
      // One statement locks every line the order touches (audit S-4). It used to be one
      // SELECT ... FOR UPDATE per line, then an UPDATE and an INSERT per line — 3N
      // round-trips with the rows LOCKED for the whole walk, so a ten-line order held a
      // popular product's row across nine other round-trips. ORDER BY inside the statement
      // keeps the deterministic lock order that stops two orders deadlocking on each other.
      const locked = await tx.$queryRaw<{ id: string; quantity: number; reserved: number }[]>(
        Prisma.sql`
          SELECT "id", "quantity", "reserved" FROM "inventory_items"
          WHERE "id" IN (${Prisma.join(ordered.map((p) => Prisma.sql`${p.itemId}::uuid`))})
          ORDER BY "id" FOR UPDATE`,
      );
      const byId = new Map(locked.map((row) => [String(row.id), row]));
      const shortfalls: { itemId: string; requested: number; available: number }[] = [];
      for (const p of ordered) {
        const row = byId.get(p.itemId);
        // A line that does not exist reads as zero sellable, exactly as before.
        const sellable = row ? available(Number(row.quantity), Number(row.reserved)) : 0;
        if (sellable < p.quantity) {
          shortfalls.push({ itemId: p.itemId, requested: p.quantity, available: sellable });
        }
      }
      if (shortfalls.length > 0) return { shortfalls }; // nothing written → clean rollback of a read-only txn
      // Per-line increments differ, so this is one UPDATE ... FROM (VALUES) rather than an
      // updateMany. The reservations go in as one insert.
      await tx.$executeRaw(Prisma.sql`
        UPDATE "inventory_items" AS i
        SET "reserved" = i."reserved" + v."qty"
        FROM (VALUES ${Prisma.join(
          ordered.map((p) => Prisma.sql`(${p.itemId}::uuid, ${p.quantity}::int)`),
        )}) AS v("id", "qty")
        WHERE i."id" = v."id"`);
      await tx.stockReservation.createMany({
        data: ordered.map((p) => ({ itemId: p.itemId, orderId, quantity: p.quantity })),
      });
      return { shortfalls: [] };
    });
  }

  /**
   * Flip an ACTIVE reservation to a terminal status and give back its held units.
   *
   * B-5: this used to read the status outside the transaction and then update on `id`
   * alone, so the ACTIVE check was a stale read by the time the write ran. Two concurrent
   * settles — a staff cancellation racing the abandoned-order sweep, release racing
   * consume, or a retry — both saw ACTIVE and both ran the decrement. `reserved` fell
   * twice for a single hold, `available` over-reported, and the depot oversold silently
   * and cumulatively, with nothing in the logs to notice.
   *
   * The claim is now the conditional `updateMany` itself: exactly one caller can move the
   * row out of ACTIVE, and only that caller (count === 1) gives the units back. Everyone
   * else sees count === 0 and stops, which is also what makes this idempotent — the same
   * discipline `reserveAtomic` uses above, expressed as a compare-and-set instead of a
   * row lock because there is a single row to claim.
   */
  private async settleReservation(
    itemId: string,
    orderId: string,
    status: ReservationStatus.RELEASED | ReservationStatus.CONSUMED,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.stockReservation.updateMany({
        where: { itemId, orderId, status: ReservationStatus.ACTIVE },
        data: { status },
      });
      // 0 = never existed, or another transaction already settled it. Either way the units
      // are not ours to return; returning them again is the oversell.
      if (claimed.count === 0) return;

      const res = await tx.stockReservation.findUnique({
        where: { itemId_orderId: { itemId, orderId } },
      });
      if (!res) return; // unreachable in practice: we just updated this row inside the txn
      await tx.inventoryItem.update({
        where: { id: itemId },
        data: { reserved: { decrement: res.quantity } },
      });
    });
  }

  async releaseReservation(itemId: string, orderId: string): Promise<void> {
    await this.settleReservation(itemId, orderId, ReservationStatus.RELEASED);
  }

  async consumeReservation(itemId: string, orderId: string): Promise<void> {
    await this.settleReservation(itemId, orderId, ReservationStatus.CONSUMED);
  }
}
