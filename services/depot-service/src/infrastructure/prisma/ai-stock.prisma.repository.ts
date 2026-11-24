import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import {
  AiStockRepository,
  MovementRow,
  PurchaseOrderRow,
  RejectedOpnameRow,
  StockLineRow,
} from '../../application/ports/ai-stock.repository';
import { InventoryItemType } from '../../domain/inventory';
import { PoLine } from '../../domain/purchase-order';
import { PrismaService } from './prisma.service';

/** Most rows one answer will read. Past it the answer is refused (422), never a partial sum. */
export const AI_STOCK_ROW_CAP = 20_000;

const guard = <T>(rows: T[]): T[] => {
  if (rows.length > AI_STOCK_ROW_CAP) {
    throw new UnprocessableEntityException(`Lebih dari ${AI_STOCK_ROW_CAP} baris; persempit depot atau periode.`);
  }
  return rows;
};

interface MovementSelect {
  id: string;
  itemId: string;
  delta: number;
  reason: string | null;
  createdAt: Date;
  item: { depotId: string; itemType: string; productId: string | null };
}

const toMovement = (r: MovementSelect): MovementRow => ({
  id: r.id,
  itemId: r.itemId,
  depotId: r.item.depotId,
  itemType: r.item.itemType as InventoryItemType,
  productId: r.item.productId,
  delta: r.delta,
  reason: r.reason,
  createdAt: r.createdAt,
});

const MOVEMENT_SELECT = {
  id: true,
  itemId: true,
  delta: true,
  reason: true,
  createdAt: true,
  item: { select: { depotId: true, itemType: true, productId: true } },
} as const;

@Injectable()
export class AiStockPrismaRepository implements AiStockRepository {
  constructor(private readonly prisma: PrismaService) {}

  async stockLines(depotIds: readonly string[]): Promise<StockLineRow[]> {
    const rows = await this.prisma.inventoryItem.findMany({
      where: { depotId: { in: [...depotIds] }, hidden: false },
      select: { depotId: true, itemType: true, quantity: true, reserved: true, minimumStock: true },
      take: AI_STOCK_ROW_CAP + 1,
    });
    return guard(rows).map((r) => ({ ...r, itemType: r.itemType as InventoryItemType }));
  }

  async lossAdjustments(depotIds: readonly string[], from: Date, to: Date): Promise<MovementRow[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        type: 'ADJUSTMENT',
        delta: { lt: 0 },
        item: { depotId: { in: [...depotIds] } },
        createdAt: { gte: from, lt: to },
      },
      select: MOVEMENT_SELECT,
      take: AI_STOCK_ROW_CAP + 1,
    });
    return guard(rows).map(toMovement);
  }

  async opnameMovements(depotIds: readonly string[], from: Date, to: Date): Promise<MovementRow[]> {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        type: 'OPNAME',
        item: { depotId: { in: [...depotIds] } },
        createdAt: { gte: from, lt: to },
      },
      select: MOVEMENT_SELECT,
      take: AI_STOCK_ROW_CAP + 1,
    });
    return guard(rows).map(toMovement);
  }

  async rejectedOpnames(depotIds: readonly string[], from: Date, to: Date): Promise<RejectedOpnameRow[]> {
    const rows = await this.prisma.approval.findMany({
      where: {
        type: 'OPNAME_VARIANCE',
        status: 'REJECTED',
        depotId: { in: [...depotIds] },
        createdAt: { gte: from, lt: to },
      },
      select: { depotId: true, createdAt: true, payload: true },
      take: AI_STOCK_ROW_CAP + 1,
    });
    return guard(rows).map((r) => {
      const p = (r.payload ?? {}) as { itemId?: unknown; variance?: unknown };
      return {
        depotId: r.depotId,
        createdAt: r.createdAt,
        itemId: typeof p.itemId === 'string' ? p.itemId : null,
        variance: typeof p.variance === 'number' ? p.variance : null,
      };
    });
  }

  async purchaseOrders(
    depotIds: readonly string[],
    asOf: Date,
    statuses: ('SENT' | 'RECEIVED')[],
  ): Promise<PurchaseOrderRow[]> {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: { depotId: { in: [...depotIds] }, status: { in: statuses }, createdAt: { lte: asOf } },
      orderBy: { createdAt: 'desc' },
      select: { depotId: true, status: true, createdAt: true, receivedAt: true, lines: true },
      take: AI_STOCK_ROW_CAP + 1,
    });
    return guard(rows).map((r) => ({
      depotId: r.depotId,
      status: r.status as 'SENT' | 'RECEIVED',
      createdAt: r.createdAt,
      receivedAt: r.receivedAt,
      lines: Array.isArray(r.lines) ? (r.lines as unknown as PoLine[]) : [],
    }));
  }

  async damagedGallons(depotId: string, from: Date, to: Date): Promise<number> {
    const agg = await this.prisma.gallonReturn.aggregate({
      where: { depotId, condition: 'DAMAGED', createdAt: { gte: from, lt: to } },
      _sum: { quantity: true },
    });
    return agg._sum.quantity ?? 0;
  }
}
