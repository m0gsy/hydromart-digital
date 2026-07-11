import { Injectable } from '@nestjs/common';

import { toUtcDay } from '../../domain/series';
import {
  CustomerActivityRow,
  DemandRow,
  ForecastRepository,
  IngestCommand,
  ProductRefRecord,
  RevenueRow,
} from '../../application/ports/forecast.repository';
import { PrismaService } from './prisma.service';

const MS_PER_DAY = 86_400_000;

/** Epoch day number -> UTC-midnight Date for the @db.Date `day` column. */
function dayToDate(day: number): Date {
  return new Date(day * MS_PER_DAY);
}

@Injectable()
export class ForecastPrismaRepository implements ForecastRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasIngested(orderId: string): Promise<boolean> {
    const row = await this.prisma.ingestedOrder.findUnique({ where: { orderId } });
    return row !== null;
  }

  async applyIngest(cmd: IngestCommand): Promise<void> {
    const day = dayToDate(toUtcDay(cmd.at));
    await this.prisma.$transaction(async (tx) => {
      // Idempotent no-op if already ingested; the PK create below is the concurrency backstop.
      const already = await tx.ingestedOrder.findUnique({ where: { orderId: cmd.orderId } });
      if (already) return;

      for (const item of cmd.items) {
        await tx.productRef.upsert({
          where: { productId: item.productId },
          create: { productId: item.productId, name: item.productName, sku: item.sku, unit: item.unit },
          update: { name: item.productName, sku: item.sku, unit: item.unit },
        });

        // Prisma's compound-unique where input requires a non-null depotId, but depotId is
        // nullable here, so upsert-by-compound-key isn't typeable. Find-then-write instead;
        // safe within one interactive $transaction for the common (non-concurrent) case.
        // ponytail: two CONCURRENT ingests racing on the same product+day have a known ceiling:
        //   depotId=null -> Postgres unique treats NULL != NULL so both create (harmless extra
        //   rows; denseDailySeries re-sums per day). non-null depotId -> loser hits P2002 and the
        //   whole tx rolls back, leaving no IngestedOrder row so a later rebuild re-ingests it.
        //   Upgrade path: partial unique index WHERE depot_id IS NULL + raw ON CONFLICT upsert.
        const existing = await tx.productDailyDemand.findFirst({
          where: { productId: item.productId, depotId: cmd.depotId, day },
        });
        if (existing) {
          await tx.productDailyDemand.update({
            where: { id: existing.id },
            data: { quantity: { increment: item.quantity }, orderCount: { increment: 1 } },
          });
        } else {
          await tx.productDailyDemand.create({
            data: {
              productId: item.productId,
              depotId: cmd.depotId,
              day,
              quantity: item.quantity,
              orderCount: 1,
            },
          });
        }
      }

      // DepotDailyRevenue: same nullable-depot find-then-write pattern + ceiling as demand above.
      const existingRev = await tx.depotDailyRevenue.findFirst({ where: { depotId: cmd.depotId, day } });
      if (existingRev) {
        await tx.depotDailyRevenue.update({
          where: { id: existingRev.id },
          data: { revenue: { increment: cmd.total }, orderCount: { increment: 1 } },
        });
      } else {
        await tx.depotDailyRevenue.create({
          data: { depotId: cmd.depotId, day, revenue: cmd.total, orderCount: 1 },
        });
      }

      // CustomerActivity: customerId is the PK so upsert-by-where is typeable; lastOrderAt keeps
      // the max (rebuilds may replay out of order), depotId reflects this order's depot.
      const existingCust = await tx.customerActivity.findUnique({ where: { customerId: cmd.customerId } });
      const lastOrderAt = existingCust && existingCust.lastOrderAt > cmd.at ? existingCust.lastOrderAt : cmd.at;
      await tx.customerActivity.upsert({
        where: { customerId: cmd.customerId },
        create: { customerId: cmd.customerId, depotId: cmd.depotId, lastOrderAt: cmd.at, orderCount: 1, totalSpent: cmd.total },
        update: { depotId: cmd.depotId, lastOrderAt, orderCount: { increment: 1 }, totalSpent: { increment: cmd.total } },
      });

      // P2002 here under concurrency rolls back the whole tx (documented ceiling); not swallowed.
      await tx.ingestedOrder.create({ data: { orderId: cmd.orderId } });
    });
  }

  async findDemandRows(query: {
    productId: string;
    depotId?: string | null;
    fromDay: number;
    toDay: number;
  }): Promise<DemandRow[]> {
    const { productId, depotId, fromDay, toDay } = query;
    const rows = await this.prisma.productDailyDemand.findMany({
      where: {
        productId,
        day: { gte: dayToDate(fromDay), lte: dayToDate(toDay) },
        // undefined -> no filter (all depots); null -> only null-depot; id -> that depot.
        ...(depotId === undefined ? {} : { depotId }),
      },
    });
    return rows.map((r) => ({
      productId: r.productId,
      depotId: r.depotId,
      day: toUtcDay(r.day),
      quantity: r.quantity,
    }));
  }

  async listDepotProducts(query: {
    depotId: string;
    fromDay: number;
    toDay: number;
  }): Promise<{ productId: string; rows: DemandRow[] }[]> {
    const { depotId, fromDay, toDay } = query;
    const rows = await this.prisma.productDailyDemand.findMany({
      where: { depotId, day: { gte: dayToDate(fromDay), lte: dayToDate(toDay) } },
    });

    const byProduct = new Map<string, DemandRow[]>();
    for (const r of rows) {
      const row: DemandRow = {
        productId: r.productId,
        depotId: r.depotId,
        day: toUtcDay(r.day),
        quantity: r.quantity,
      };
      const bucket = byProduct.get(r.productId);
      if (bucket) bucket.push(row);
      else byProduct.set(r.productId, [row]);
    }
    return [...byProduct].map(([productId, productRows]) => ({ productId, rows: productRows }));
  }

  async findRefs(productIds: string[]): Promise<ProductRefRecord[]> {
    const rows = await this.prisma.productRef.findMany({ where: { productId: { in: productIds } } });
    return rows.map((r) => ({ productId: r.productId, name: r.name, sku: r.sku, unit: r.unit }));
  }

  async findRevenueRows(query: {
    depotId?: string | null;
    fromDay: number;
    toDay: number;
  }): Promise<RevenueRow[]> {
    const { depotId, fromDay, toDay } = query;
    const rows = await this.prisma.depotDailyRevenue.findMany({
      where: {
        day: { gte: dayToDate(fromDay), lte: dayToDate(toDay) },
        // undefined -> no filter (all depots); null -> only null-depot; id -> that depot.
        ...(depotId === undefined ? {} : { depotId }),
      },
    });
    return rows.map((r) => ({ depotId: r.depotId, day: toUtcDay(r.day), revenue: r.revenue }));
  }

  async listCustomerActivity(query: {
    depotId?: string | null;
    limit: number;
  }): Promise<CustomerActivityRow[]> {
    const { depotId, limit } = query;
    const rows = await this.prisma.customerActivity.findMany({
      where: { ...(depotId === undefined ? {} : { depotId }) },
      orderBy: { lastOrderAt: 'asc' }, // oldest / most at-risk first
      take: limit,
    });
    return rows.map((r) => ({
      customerId: r.customerId,
      depotId: r.depotId,
      lastOrderAt: r.lastOrderAt,
      orderCount: r.orderCount,
      totalSpent: r.totalSpent,
    }));
  }
}
