import { Injectable } from '@nestjs/common';

import { readAllPages } from '@hydromart/platform';

import { InventoryItemType } from '../../domain/inventory';
import { ReportRangeTooLargeError } from '../../domain/errors';
import { PoLine } from '../../domain/purchase-order';
import {
  OperationalReportInputs,
  OperationalReportRange,
  OperationalReportRepository,
} from '../../application/ports/operational-report.repository';
import { PrismaService } from './prisma.service';

/** Rows per keyset page while walking a report window. */
const REPORT_PAGE_SIZE = 500;
/** Ceiling per read. Months of movements for a busy depot, and still one response. */
const MAX_REPORT_ROWS = 20_000;

@Injectable()
export class OperationalReportPrismaRepository implements OperationalReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Three unbounded reads used to back this report, one of them cumulative over every
   * purchase order the depot ever received (audit H-44). Each is now a keyset walk in
   * pages, and a window past MAX_REPORT_ROWS is refused rather than truncated: a day-book
   * missing part of its own sales is worse than no day-book.
   */
  async load(depotId: string, range: OperationalReportRange): Promise<OperationalReportInputs> {
    const bounds = {
      pageSize: REPORT_PAGE_SIZE,
      max: MAX_REPORT_ROWS,
      onOverflow: (): never => {
        throw new ReportRangeTooLargeError(MAX_REPORT_ROWS);
      },
    };
    const [sales, receivedPurchaseOrders, outflows] = await Promise.all([
      readAllPages(
        ({ take, cursor }) =>
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
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }),
        bounds,
      ),
      readAllPages(
        ({ take, cursor }) =>
          this.prisma.purchaseOrder.findMany({
            where: {
              depotId,
              // Deliberately cumulative — no lower bound. The report values what the depot
              // has received up to `to`, not only what arrived inside the window.
              status: 'RECEIVED',
              receivedAt: { not: null, lt: range.to },
            },
            select: { id: true, poNumber: true, receivedAt: true, lines: true },
            orderBy: [{ receivedAt: 'asc' }, { poNumber: 'asc' }, { id: 'asc' }],
            take,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }),
        bounds,
      ),
      readAllPages(
        ({ take, cursor }) =>
          this.prisma.cashbookEntry.findMany({
            where: {
              depotId,
              direction: 'OUT',
              occurredAt: { gte: range.from, lt: range.to },
            },
            select: {
              id: true,
              category: true,
              amountIdr: true,
              sourceRef: true,
              occurredAt: true,
            },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            take,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          }),
        bounds,
      ),
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
