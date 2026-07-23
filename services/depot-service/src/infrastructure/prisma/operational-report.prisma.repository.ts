import { Injectable } from '@nestjs/common';

import { InventoryItemType } from '../../domain/inventory';
import { PoLine } from '../../domain/purchase-order';
import {
  OperationalReportInputs,
  OperationalReportRange,
  OperationalReportRepository,
} from '../../application/ports/operational-report.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class OperationalReportPrismaRepository implements OperationalReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async load(depotId: string, range: OperationalReportRange): Promise<OperationalReportInputs> {
    const [sales, receivedPurchaseOrders, outflows] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: {
          type: 'SALE',
          createdAt: { gte: range.from, lt: range.to },
          item: { depotId },
        },
        select: {
          id: true,
          itemId: true,
          delta: true,
          createdAt: true,
          item: { select: { itemType: true, label: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          depotId,
          status: 'RECEIVED',
          receivedAt: { not: null, lt: range.to },
        },
        select: { id: true, poNumber: true, receivedAt: true, lines: true },
        orderBy: [{ receivedAt: 'asc' }, { poNumber: 'asc' }],
      }),
      this.prisma.cashbookEntry.findMany({
        where: {
          depotId,
          direction: 'OUT',
          occurredAt: { gte: range.from, lt: range.to },
        },
        select: { id: true, category: true, amountIdr: true, sourceRef: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
    ]);

    return {
      sales: sales.map((row) => ({
        movementId: row.id,
        itemId: row.itemId,
        itemType: row.item.itemType as InventoryItemType,
        label: row.item.label,
        quantitySold: Math.max(0, -row.delta),
        occurredAt: row.createdAt,
      })),
      receivedPurchaseOrders: receivedPurchaseOrders.map((row) => ({
        id: row.id,
        poNumber: row.poNumber,
        receivedAt: row.receivedAt as Date,
        lines: row.lines as unknown as PoLine[],
      })),
      outflows,
    };
  }
}
