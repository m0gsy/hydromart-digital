import { Inject, Injectable } from '@nestjs/common';

import {
  InventoryItemType,
  StockMovementType,
  available,
  isLowStock,
  isProductLine,
} from '../../domain/inventory';
import {
  DepotNotFoundError,
  DuplicateInventoryLineError,
  InsufficientStockError,
  InventoryItemNotFoundError,
  NegativeStockError,
  ProductLineRequiresProductError,
} from '../../domain/errors';
import {
  DepotMovementFilter,
  DepotProductPrice,
  DepotStockMovementRecord,
  InventoryItemRecord,
  InventoryListFilter,
  InventoryRepository,
  StockMovementRecord,
} from '../ports/inventory.repository';
import { buildPage, Page } from '../pagination';
import { DepotRepository } from '../ports/depot.repository';
import { LowStockAlertPort } from '../ports/low-stock-alert.port';
import { DEPOT_TOKENS } from '../tokens';
import { ApprovalType, needsApproval } from '../../domain/approval';
import { ApprovalService } from './approval.service';
import { DepotConfigService } from '../../config/depot-config.service';

export interface CreateLineInput {
  itemType: InventoryItemType;
  productId?: string | null;
  label: string;
  unit: string;
  quantity: number;
  minimumStock: number;
  /** Per-depot price override for PRODUK lines (IDR); null/omitted = catalog base price. */
  sellPrice?: number | null;
}

export interface ItemView extends InventoryItemRecord {
  lowStock: boolean;
  /** Sellable stock = quantity - reserved. */
  available: number;
}

export interface WastageItem {
  label: string;
  /** Total units lost (absolute sum of negative ADJUSTMENT deltas). */
  qty: number;
  /** qty × sellPrice; omitted for raw lines with no price. */
  lossIdr?: number;
}

export interface WastageSummary {
  depotId: string;
  from: string | null;
  to: string | null;
  /** Sum of every priced item's lossIdr; omitted when no wasted line has a price. */
  totalLossIdr?: number;
  byItem: WastageItem[];
}

export interface ReserveResult {
  orderId: string;
  depotId: string;
  reserved: string[];
  skipped: string[];
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
    private readonly approvals: ApprovalService,
    private readonly config: DepotConfigService,
  ) {}

  private toView(item: InventoryItemRecord): ItemView {
    const sellable = available(item.quantity, item.reserved);
    return {
      ...item,
      // Low stock is judged on SELLABLE stock (available), not physical quantity:
      // units held by active reservations can't fulfil a new order (FR-074).
      lowStock: isLowStock(sellable, item.minimumStock),
      available: sellable,
    };
  }

  /**
   * Fires a low-stock alert only when a change *crosses* the line into low stock
   * (edge trigger) — not on every subsequent drop while already low, so a low
   * product does not spam the ops number. Measured on AVAILABLE (sellable) stock,
   * so a reservation that exhausts sellable stock alerts even while physical
   * quantity is still on hand; a consume that merely converts a hold into a sale
   * leaves available unchanged and does not re-alert.
   */
  private async alertIfNewlyLow(
    line: InventoryItemRecord,
    availableBefore: number,
    availableAfter: number,
    authorization: string,
  ): Promise<void> {
    if (!isLowStock(availableAfter, line.minimumStock) || isLowStock(availableBefore, line.minimumStock)) {
      return;
    }
    const depot = await this.depots.findById(line.depotId, false);
    await this.lowStockAlert.emit(
      {
        depotId: line.depotId,
        depotName: depot?.name ?? line.depotId,
        label: line.label,
        quantity: availableAfter,
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
      sellPrice: input.sellPrice ?? null,
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
    patch: { label?: string; unit?: string; minimumStock?: number; sellPrice?: number | null },
  ): Promise<ItemView> {
    await this.require(itemId);
    const updated = await this.inventory.update(itemId, patch);
    return this.toView(updated);
  }

  /**
   * Per-depot price overrides for the given products (FR: WARALABA depots price
   * independently). Only PRODUK lines with a set sellPrice are returned; products
   * without an override are absent, so order-service falls back to the catalog base.
   */
  async pricesForProducts(depotId: string, productIds: string[]): Promise<DepotProductPrice[]> {
    return this.inventory.findPrices(depotId, productIds);
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
    // Reserved is unchanged by an adjustment, so available moves with quantity.
    await this.alertIfNewlyLow(
      item,
      available(item.quantity, item.reserved),
      available(next, item.reserved),
      authorization,
    );
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
    // Opname reconciles physical quantity; reserved is unchanged.
    await this.alertIfNewlyLow(
      item,
      available(item.quantity, item.reserved),
      available(countedQuantity, item.reserved),
      authorization,
    );
    await this.emitVarianceApproval(item, variance, reason, actorId);
    return this.toView(updated);
  }

  /**
   * Best-effort: raise an OPNAME_VARIANCE approval when the loss value clears the depot's
   * threshold (the ApprovalService auto-passes anything under it, so this only surfaces the
   * ones a manager must actually decide). ponytail: the rupiah value uses the PRODUK
   * sellPrice; raw lines (no price) value to 0 and never emit — give raw types a per-unit
   * value if their opname must be approvable too. Never blocks the opname on failure.
   */
  private async emitVarianceApproval(
    item: InventoryItemRecord,
    variance: number,
    reason: string | null,
    actorId: string,
  ): Promise<void> {
    if (variance === 0) return;
    const amountIdr = Math.round(variance * (item.sellPrice ?? 0));
    if (!needsApproval(amountIdr, this.config.approvalAutoPassIdr(item.depotId))) return;
    try {
      await this.approvals.create(
        {
          depotId: item.depotId,
          type: ApprovalType.OPNAME_VARIANCE,
          title: `Selisih opname ${item.label}`,
          subjectRef: item.label,
          amountIdr,
          payload: {
            system: item.quantity,
            physical: item.quantity + variance,
            variance,
            reason: reason ?? undefined,
          },
        },
        actorId,
      );
    } catch {
      // Approval emission is a side channel — a failure here must not fail the opname.
    }
  }

  /**
   * Holds stock for an order at checkout so two customers cannot both buy the last
   * unit (oversell prevention). Each product maps to the depot's PRODUK line;
   * products the depot does not stock are skipped (never block checkout). If any
   * stocked product lacks enough sellable stock (quantity - reserved), the whole
   * reservation is rejected (InsufficientStockError) before any hold is written.
   * Idempotent per order: a line already reserved for this order is a no-op.
   *
   * Ceiling: the check-then-reserve is not fully serializable, so two concurrent
   * checkouts for the same last unit can both pass the availability check (TOCTOU).
   * The window is small; a serializable upgrade is SELECT ... FOR UPDATE per line.
   */
  async reserveForOrder(
    depotId: string,
    orderId: string,
    items: { productId: string; quantity: number }[],
    // ponytail: actorId kept for signature symmetry with consume/adjust; reservations
    // carry no actor column, so it is currently unused.
    _actorId: string,
    authorization = '',
  ): Promise<ReserveResult> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const reserved: string[] = [];
    const skipped: string[] = [];
    const plans: { itemId: string; productId: string; quantity: number; line: InventoryItemRecord }[] = [];

    for (const { productId, quantity } of items) {
      if (quantity <= 0) {
        continue;
      }
      const line = await this.inventory.findLine(depotId, InventoryItemType.PRODUK, productId);
      if (!line) {
        skipped.push(productId);
        continue;
      }
      // Already held for this order (retry) — report reserved, don't double-hold.
      if (await this.inventory.findReservation(line.id, orderId)) {
        reserved.push(productId);
        continue;
      }
      plans.push({ itemId: line.id, productId, quantity, line });
    }

    if (plans.length > 0) {
      // The availability re-check + all holds happen in one serializable, row-locked
      // transaction, so concurrent orders can't both claim the last unit (all-or-nothing).
      const { shortfalls } = await this.inventory.reserveAtomic(
        plans.map((p) => ({ itemId: p.itemId, quantity: p.quantity })),
        orderId,
      );
      if (shortfalls.length > 0) {
        const productByItem = new Map(plans.map((p) => [p.itemId, p.productId]));
        throw new InsufficientStockError(
          shortfalls.map((s) => ({
            productId: productByItem.get(s.itemId) ?? s.itemId,
            requested: s.requested,
            available: s.available,
          })),
        );
      }
      // Reserving drops available, so this is where a line first becomes sellable-low
      // (physical quantity is untouched). Edge-triggered per line.
      for (const p of plans) {
        reserved.push(p.productId);
        await this.alertIfNewlyLow(
          p.line,
          available(p.line.quantity, p.line.reserved),
          available(p.line.quantity, p.line.reserved + p.quantity),
          authorization,
        );
      }
    }
    return { orderId, depotId, reserved, skipped };
  }

  /**
   * Releases an order's stock holds (on cancellation). Each product maps to the
   * depot's PRODUK line; a released or absent hold is a no-op (idempotent).
   */
  async releaseForOrder(
    depotId: string,
    orderId: string,
    items: { productId: string; quantity: number }[],
  ): Promise<{ orderId: string; depotId: string; released: string[] }> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const released: string[] = [];
    for (const { productId } of items) {
      const line = await this.inventory.findLine(depotId, InventoryItemType.PRODUK, productId);
      if (!line) {
        continue;
      }
      await this.inventory.releaseReservation(line.id, orderId);
      released.push(productId);
    }
    return { orderId, depotId, released };
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
      // Convert the checkout-time hold into a real deduction (releases reserved units).
      await this.inventory.consumeReservation(line.id, orderId);
      // Available is measured after both writes: when a reservation existed the
      // sale leaves available flat (already low since checkout — no re-alert); an
      // unreserved sale drops available and can newly cross the threshold.
      const fresh = await this.inventory.findById(line.id);
      if (fresh) {
        await this.alertIfNewlyLow(
          line,
          available(line.quantity, line.reserved),
          available(fresh.quantity, fresh.reserved),
          authorization,
        );
      }
      consumed.push(productId);
    }
    return { orderId, depotId, consumed, skipped };
  }

  /**
   * Procurement goods-receipt: append a RECEIPT movement of `quantity` to the depot's
   * raw stock line for `itemType` (Air/Galon/Tutup/Segel singleton, productId null).
   * Called in-process by PurchaseOrderService.receive — a direct method call, no HTTP.
   * Throws InventoryItemNotFoundError if the depot has no such line; the caller receives
   * best-effort, so a missing line does not fail the whole PO.
   * ponytail: targets the raw singleton line only. A PRODUK line needs a productId a PO
   * line does not carry — give PoLine a productId if PRODUK procurement must land too.
   */
  async receiveStock(
    depotId: string,
    itemType: InventoryItemType,
    quantity: number,
    actorId: string,
    reason: string,
  ): Promise<ItemView> {
    const line = await this.inventory.findLine(depotId, itemType, null);
    if (!line) {
      throw new InventoryItemNotFoundError();
    }
    const next = line.quantity + quantity;
    const updated = await this.inventory.applyMovement(line.id, next, {
      itemId: line.id,
      type: StockMovementType.RECEIPT,
      delta: quantity,
      quantityBefore: line.quantity,
      quantityAfter: next,
      reason,
      actorId,
    });
    return this.toView(updated);
  }

  /**
   * Depot wastage from the movement ledger: every negative-delta ADJUSTMENT in the window,
   * grouped by line. qty is the real lost quantity; lossIdr values it at the line's sellPrice
   * (ponytail: raw lines like Galon/Air carry no price → qty only, no rupiah — give them a
   * per-unit value if their wastage must be costed too). Window bounds are optional.
   */
  async wastageSummary(depotId: string, from?: Date, to?: Date): Promise<WastageSummary> {
    const rows = await this.inventory.wastageAdjustments(depotId, { from, to });
    const byItem = new Map<string, { label: string; qty: number; sellPrice: number | null }>();
    for (const r of rows) {
      const cur = byItem.get(r.itemId) ?? { label: r.label, qty: 0, sellPrice: r.sellPrice };
      cur.qty += Math.abs(r.delta);
      byItem.set(r.itemId, cur);
    }
    let totalLoss = 0;
    let anyPriced = false;
    const items: WastageItem[] = [...byItem.values()]
      .sort((a, b) => b.qty - a.qty)
      .map((i) => {
        if (i.sellPrice != null) {
          const lossIdr = Math.round(i.qty * i.sellPrice);
          totalLoss += lossIdr;
          anyPriced = true;
          return { label: i.label, qty: i.qty, lossIdr };
        }
        return { label: i.label, qty: i.qty };
      });
    return {
      depotId,
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      byItem: items,
      ...(anyPriced ? { totalLossIdr: totalLoss } : {}),
    };
  }

  async movements(itemId: string): Promise<StockMovementRecord[]> {
    await this.require(itemId);
    return this.inventory.listMovements(itemId);
  }

  async listMovementsForDepot(
    depotId: string,
    filter: DepotMovementFilter,
  ): Promise<Page<DepotStockMovementRecord>> {
    if (!(await this.depots.findById(depotId, false))) {
      throw new DepotNotFoundError();
    }
    const { items, total } = await this.inventory.listForDepotMovements(depotId, filter);
    return buildPage(items, total, filter.page, filter.limit);
  }

  private async require(itemId: string): Promise<InventoryItemRecord> {
    const item = await this.inventory.findById(itemId);
    if (!item) {
      throw new InventoryItemNotFoundError();
    }
    return item;
  }
}
