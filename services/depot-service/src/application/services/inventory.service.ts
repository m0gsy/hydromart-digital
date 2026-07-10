import { Inject, Injectable } from '@nestjs/common';

import {
  InventoryItemType,
  StockMovementType,
  isLowStock,
  isProductLine,
} from '../../domain/inventory';
import {
  DepotNotFoundError,
  DuplicateInventoryLineError,
  InventoryItemNotFoundError,
  NegativeStockError,
  ProductLineRequiresProductError,
} from '../../domain/errors';
import {
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  StockMovementRecord,
} from '../ports/inventory.repository';
import { DepotRepository } from '../ports/depot.repository';
import { LowStockAlertPort } from '../ports/low-stock-alert.port';
import { DEPOT_TOKENS } from '../tokens';

export interface CreateLineInput {
  itemType: InventoryItemType;
  productId?: string | null;
  label: string;
  unit: string;
  quantity: number;
  minimumStock: number;
}

export interface ItemView extends InventoryItemRecord {
  lowStock: boolean;
}

/**
 * Per-depot inventory (PRD FR-067..074). Raw stock types (Air/Galon/Tutup/Segel) are
 * one line per depot; PRODUK lines are one per product. All quantity changes are recorded
 * in the append-only movement ledger (FR-072 adjustment, FR-073 opname, RECEIPT for opening).
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(DEPOT_TOKENS.InventoryRepository) private readonly inventory: InventoryRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    @Inject(DEPOT_TOKENS.LowStockAlert) private readonly lowStockAlert: LowStockAlertPort,
  ) {}

  private toView(item: InventoryItemRecord): ItemView {
    return { ...item, lowStock: isLowStock(item.quantity, item.minimumStock) };
  }

  /**
   * Fires a low-stock alert only when a movement *crosses* the line into low stock
   * (edge trigger) — not on every subsequent decrement while already low, so a low
   * product being sold repeatedly does not spam the ops number.
   */
  private async alertIfNewlyLow(
    line: InventoryItemRecord,
    quantityBefore: number,
    quantityAfter: number,
    authorization: string,
  ): Promise<void> {
    if (!isLowStock(quantityAfter, line.minimumStock) || isLowStock(quantityBefore, line.minimumStock)) {
      return;
    }
    const depot = await this.depots.findById(line.depotId, false);
    await this.lowStockAlert.emit(
      {
        depotId: line.depotId,
        depotName: depot?.name ?? line.depotId,
        label: line.label,
        quantity: quantityAfter,
        minimum: line.minimumStock,
      },
      authorization,
    );
  }

  async createLine(depotId: string, input: CreateLineInput, actorId: string): Promise<ItemView> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const productId = input.productId ?? null;
    // PRODUK lines must reference a product; raw stock lines must not.
    if (isProductLine(input.itemType) !== (productId !== null)) {
      throw new ProductLineRequiresProductError();
    }
    if (await this.inventory.findLine(depotId, input.itemType, productId)) {
      throw new DuplicateInventoryLineError();
    }

    const item = await this.inventory.create({
      depotId,
      itemType: input.itemType,
      productId,
      label: input.label,
      unit: input.unit,
      quantity: 0,
      minimumStock: input.minimumStock,
    });

    if (input.quantity > 0) {
      const updated = await this.inventory.applyMovement(item.id, input.quantity, {
        itemId: item.id,
        type: StockMovementType.RECEIPT,
        delta: input.quantity,
        quantityBefore: 0,
        quantityAfter: input.quantity,
        reason: 'Opening balance',
        actorId,
      });
      return this.toView(updated);
    }
    return this.toView(item);
  }

  async listForDepot(depotId: string, filter: InventoryListFilter): Promise<ItemView[]> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const items = await this.inventory.listForDepot(depotId, filter);
    return items.map((i) => this.toView(i));
  }

  /** Low-stock lines (FR-074), optionally scoped to one depot. */
  async listLowStock(depotId?: string): Promise<ItemView[]> {
    const items = await this.inventory.listLowStock(depotId);
    return items.map((i) => this.toView(i));
  }

  async get(itemId: string): Promise<ItemView> {
    return this.toView(await this.require(itemId));
  }

  async updateMeta(
    itemId: string,
    patch: { label?: string; unit?: string; minimumStock?: number },
  ): Promise<ItemView> {
    await this.require(itemId);
    const updated = await this.inventory.update(itemId, patch);
    return this.toView(updated);
  }

  /** Signed correction (FR-072). Positive receives stock, negative consumes it. */
  async adjust(
    itemId: string,
    delta: number,
    reason: string | null,
    actorId: string,
    authorization = '',
  ): Promise<ItemView> {
    const item = await this.require(itemId);
    const next = item.quantity + delta;
    if (next < 0) {
      throw new NegativeStockError();
    }
    const updated = await this.inventory.applyMovement(itemId, next, {
      itemId,
      type: StockMovementType.ADJUSTMENT,
      delta,
      quantityBefore: item.quantity,
      quantityAfter: next,
      reason,
      actorId,
    });
    await this.alertIfNewlyLow(item, item.quantity, next, authorization);
    return this.toView(updated);
  }

  /** Physical count reconciliation (FR-073): system quantity becomes the counted quantity. */
  async opname(
    itemId: string,
    countedQuantity: number,
    reason: string | null,
    actorId: string,
    authorization = '',
  ): Promise<ItemView> {
    const item = await this.require(itemId);
    const variance = countedQuantity - item.quantity;
    const updated = await this.inventory.applyMovement(itemId, countedQuantity, {
      itemId,
      type: StockMovementType.OPNAME,
      delta: variance,
      quantityBefore: item.quantity,
      quantityAfter: countedQuantity,
      reason,
      actorId,
    });
    await this.alertIfNewlyLow(item, item.quantity, countedQuantity, authorization);
    return this.toView(updated);
  }

  /**
   * Deducts sold quantities from a depot's PRODUK stock lines when an order
   * completes. Each sold product maps to that depot's PRODUK line by productId;
   * a product the depot does not stock is skipped (recorded in `skipped`), never
   * an error. SALE movements are allowed to drive stock negative so the ledger
   * reflects reality (surfaced by low-stock + reconciled at opname) rather than
   * silently dropping a sale.
   *
   * Idempotent per (line, order): a SALE movement carries its orderId and the DB
   * holds a unique (itemId, orderId), so a retried order-COMPLETED re-reports the
   * same line as consumed without deducting again. The pre-check handles the common
   * sequential retry; the unique index is the backstop for a concurrent double-fire.
   */
  async consumeForOrder(
    depotId: string,
    orderId: string,
    items: { productId: string; quantity: number }[],
    actorId: string,
    authorization = '',
  ): Promise<{ orderId: string; depotId: string; consumed: string[]; skipped: string[] }> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const consumed: string[] = [];
    const skipped: string[] = [];
    for (const { productId, quantity } of items) {
      if (quantity <= 0) {
        continue;
      }
      const line = await this.inventory.findLine(depotId, InventoryItemType.PRODUK, productId);
      if (!line) {
        skipped.push(productId);
        continue;
      }
      // Already deducted for this order (retry) — report consumed, don't deduct again.
      if (await this.inventory.hasMovementForOrder(line.id, orderId)) {
        consumed.push(productId);
        continue;
      }
      const next = line.quantity - quantity;
      await this.inventory.applyMovement(line.id, next, {
        itemId: line.id,
        type: StockMovementType.SALE,
        delta: -quantity,
        quantityBefore: line.quantity,
        quantityAfter: next,
        reason: `Order ${orderId}`,
        actorId,
        orderId,
      });
      await this.alertIfNewlyLow(line, line.quantity, next, authorization);
      consumed.push(productId);
    }
    return { orderId, depotId, consumed, skipped };
  }

  async movements(itemId: string): Promise<StockMovementRecord[]> {
    await this.require(itemId);
    return this.inventory.listMovements(itemId);
  }

  private async require(itemId: string): Promise<InventoryItemRecord> {
    const item = await this.inventory.findById(itemId);
    if (!item) {
      throw new InventoryItemNotFoundError();
    }
    return item;
  }
}
