import { Inject, Injectable } from '@nestjs/common';

import { InventoryItemType, available } from '../../domain/inventory';
import { PoLine, isShortClosed, receivedOf } from '../../domain/purchase-order';
import { AI_STOCK_REPOSITORY, AiStockRepository, MovementRow, PurchaseOrderRow } from '../ports/ai-stock.repository';

/** An opname and the approval it raised are written one after the other; this is how far apart their stamps may be. */
export const APPROVAL_MATCH_MS = 120_000;

export interface StockPositionRow {
  depotId: string;
  lines: number;
  /** Lines whose available stock is at or below a minimum that is set. */
  lowLines: number;
  /** Lines with nothing available (a fact: a line without a minimum is still `habis`). */
  outLines: number;
  byType: { itemType: InventoryItemType; availableUnits: number; lines: number }[];
}

export interface LossRow {
  depotId: string;
  itemType: InventoryItemType;
  /** Units lost (wastage) or net counted-minus-system units (opname, signed). */
  units: number;
  /** At the last purchase price on each movement's date; null when no unit of the row could be priced. */
  valueIdr: number | null;
  /** Units no purchase price was found for: not in `valueIdr`. */
  unpricedUnits: number;
}

export interface OpenPurchaseRow {
  depotId: string;
  /** Purchase orders sent and not fully received. */
  orders: number;
  /** Goods still expected: (ordered - received) x unit cost, short-closed lines left out, shipping not included. */
  valueIdr: number;
}

interface Cost {
  depotId: string;
  itemType: InventoryItemType;
  productId: string | null;
  at: number;
  unitCostIdr: number;
}

const sameLine = (c: Cost, m: { depotId: string; itemType: InventoryItemType; productId: string | null }): boolean =>
  c.depotId === m.depotId && c.itemType === m.itemType && c.productId === m.productId;

/** A line still expecting goods: not fully in, not closed short with a reason. */
const waiting = (l: PoLine): boolean => receivedOf(l) < l.quantity && !isShortClosed(l);

/**
 * HD-6 H4: stock facts for the AI read API. Reads only; valuation is at the last purchase price
 * (decisions 25-A and 26-A), never the selling price.
 */
@Injectable()
export class AiStockService {
  constructor(@Inject(AI_STOCK_REPOSITORY) private readonly repo: AiStockRepository) {}

  async stockPosition(depotIds: readonly string[]): Promise<StockPositionRow[]> {
    const rows = new Map<string, StockPositionRow>();
    for (const l of await this.repo.stockLines(depotIds)) {
      const row = rows.get(l.depotId) ?? { depotId: l.depotId, lines: 0, lowLines: 0, outLines: 0, byType: [] };
      const avail = available(l.quantity, l.reserved);
      row.lines += 1;
      if (l.minimumStock > 0 && avail <= l.minimumStock) row.lowLines += 1;
      if (avail <= 0) row.outLines += 1;
      let type = row.byType.find((t) => t.itemType === l.itemType);
      if (!type) {
        type = { itemType: l.itemType, availableUnits: 0, lines: 0 };
        row.byType.push(type);
      }
      type.availableUnits += avail;
      type.lines += 1;
      rows.set(l.depotId, row);
    }
    return [...rows.values()];
  }

  /**
   * Purchase prices (decision 11-A): lines of RECEIVED orders, dated by the day they were received,
   * newest first. A price is only known from the day the order was received, so a SENT order never
   * sets one; a line at 0 (a free sample) is no price at all, it must not zero a valuation.
   */
  private costsOf(orders: readonly PurchaseOrderRow[]): Cost[] {
    const out: Cost[] = [];
    for (const po of orders) {
      const at = (po.receivedAt ?? po.createdAt).getTime();
      for (const line of po.lines) {
        // A RECEIVED order written before partial receipts carries no receivedQuantity: it took all of it.
        const took = line.receivedQuantity === undefined ? true : receivedOf(line) > 0;
        if (took && line.unitCostIdr > 0) {
          out.push({ depotId: po.depotId, itemType: line.itemType, productId: line.productId ?? null, at, unitCostIdr: line.unitCostIdr });
        }
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }

  private async costs(depotIds: readonly string[], asOf: Date): Promise<Cost[]> {
    return this.costsOf(await this.repo.receivedPurchaseOrders(depotIds, asOf));
  }

  private priceAt(costs: readonly Cost[], m: { depotId: string; itemType: InventoryItemType; productId: string | null }, at: Date): number | null {
    return costs.find((c) => c.at <= at.getTime() && sameLine(c, m))?.unitCostIdr ?? null;
  }

  /** Units (`sign` -1 turns a loss into a positive count) and their value per depot and type. */
  private tally(movements: readonly MovementRow[], costs: readonly Cost[], sign: 1 | -1): LossRow[] {
    const rows = new Map<string, LossRow>();
    for (const m of movements) {
      const key = `${m.depotId}|${m.itemType}`;
      const row = rows.get(key) ?? { depotId: m.depotId, itemType: m.itemType, units: 0, valueIdr: null, unpricedUnits: 0 };
      const units = m.delta * sign;
      const price = this.priceAt(costs, m, m.createdAt);
      row.units += units;
      if (price === null) row.unpricedUnits += Math.abs(units);
      else row.valueIdr = (row.valueIdr ?? 0) + units * price;
      rows.set(key, row);
    }
    return [...rows.values()].map((r) => ({ ...r, valueIdr: r.valueIdr === null ? null : Math.round(r.valueIdr) }));
  }

  /**
   * Wastage: broken or lost stock (negative adjustments) without the gallons lent with a delivery
   * and without the reversal of a rejected count, plus gallons handed back damaged.
   */
  async wastage(depotIds: readonly string[], from: Date, to: Date): Promise<LossRow[]> {
    // Lent gallons and rejected-count reversals are already left out by the repository's query.
    const [moves, damaged, costs] = await Promise.all([
      this.repo.lossAdjustments(depotIds, from, to),
      this.repo.damagedGallons(depotIds, from, to),
      this.costs(depotIds, to),
    ]);
    const rows = this.tally(moves, costs, -1);
    for (const d of damaged) {
      // A returned empty never enters the GALON line, so it cannot already be among the adjustments.
      let row = rows.find((r) => r.depotId === d.depotId && r.itemType === InventoryItemType.GALON);
      if (!row) {
        row = { depotId: d.depotId, itemType: InventoryItemType.GALON, units: 0, valueIdr: null, unpricedUnits: 0 };
        rows.push(row);
      }
      row.units += d.quantity;
      // Priced at its own date, like every other loss.
      const price = this.priceAt(costs, { depotId: d.depotId, itemType: InventoryItemType.GALON, productId: null }, d.createdAt);
      if (price === null) row.unpricedUnits += d.quantity;
      else row.valueIdr = Math.round((row.valueIdr ?? 0) + d.quantity * price);
    }
    return rows;
  }

  /** Opname: counted minus system per count, signed, rejected variances left out. */
  async opname(depotIds: readonly string[], from: Date, to: Date): Promise<LossRow[]> {
    const [movements, rejected, costs] = await Promise.all([
      this.repo.opnameMovements(depotIds, from, to),
      this.repo.rejectedOpnames(depotIds, new Date(from.getTime() - APPROVAL_MATCH_MS), new Date(to.getTime() + APPROVAL_MATCH_MS)),
      this.costs(depotIds, to),
    ]);
    const left = [...movements];
    for (const r of rejected) {
      if (r.itemId === null || r.variance === null) continue;
      const i = left.findIndex(
        (m) => m.itemId === r.itemId && m.delta === r.variance && Math.abs(m.createdAt.getTime() - r.createdAt.getTime()) <= APPROVAL_MATCH_MS,
      );
      if (i >= 0) left.splice(i, 1);
    }
    return this.tally(left, costs, 1);
  }

  /** Purchase orders sent and not yet fully received, per depot. */
  async openPurchases(depotIds: readonly string[]): Promise<OpenPurchaseRow[]> {
    const rows = new Map<string, OpenPurchaseRow>();
    for (const po of await this.repo.sentPurchaseOrders(depotIds)) {
      const pending = po.lines.filter(waiting);
      if (pending.length === 0) continue;
      const row = rows.get(po.depotId) ?? { depotId: po.depotId, orders: 0, valueIdr: 0 };
      row.orders += 1;
      row.valueIdr += pending.reduce((s, l) => s + (l.quantity - receivedOf(l)) * l.unitCostIdr, 0);
      rows.set(po.depotId, row);
    }
    return [...rows.values()];
  }
}
