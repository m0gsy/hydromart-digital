import { Injectable } from '@nestjs/common';

import { dateToDay } from '../../domain/series';
import {
  CustomerActivityRow,
  DemandRow,
  ForecastRepository,
  IngestCommand,
  ProductRefRecord,
  RevenueRow,
} from '../../application/ports/forecast.repository';
import { Prisma } from '../../../prisma/generated/client';
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

  async applyIngest(cmd: IngestCommand, dayNumber: number): Promise<void> {
    const day = dayToDate(dayNumber);
    await this.prisma.$transaction(async (tx) => {
      // Idempotent no-op if already ingested; the PK create below is the concurrency backstop.
      const already = await tx.ingestedOrder.findUnique({ where: { orderId: cmd.orderId } });
      if (already) return;

      // Audit S-20: three statements per item inside an interactive transaction, so a
      // ten-line order held its locks across thirty round-trips. Three statements for the
      // whole order now. A product listed twice is folded into one row first — an INSERT
      // cannot touch the same conflicting row twice, and two increments are one sum.
      const perProduct = new Map<
        string,
        { item: IngestCommand['items'][number]; quantity: number; orders: number }
      >();
      for (const item of cmd.items) {
        const current = perProduct.get(item.productId);
        if (current) {
          current.quantity += item.quantity;
          current.orders += 1;
        } else {
          perProduct.set(item.productId, { item, quantity: item.quantity, orders: 1 });
        }
      }
      const products = [...perProduct.values()];

      if (products.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "product_ref" ("productId", "name", "sku", "unit", "updatedAt")
          VALUES ${Prisma.join(
            products.map(
              (p) =>
                Prisma.sql`(${p.item.productId}::uuid, ${p.item.productName}, ${p.item.sku}, ${p.item.unit}, NOW())`,
            ),
          )}
          ON CONFLICT ("productId") DO UPDATE
          SET "name" = EXCLUDED."name", "sku" = EXCLUDED."sku", "unit" = EXCLUDED."unit",
              "updatedAt" = NOW()`);

        // The @@unique carries a nullable depotId and Postgres unique treats NULL as
        // distinct, so ON CONFLICT cannot be used for a depot-less order. Read what exists,
        // bump those, insert the rest.
        // ponytail: the concurrency ceiling is unchanged — depotId = null lets two racing
        //   ingests both insert (extra rows, correct totals, since the series re-sums per
        //   day); a non-null depotId makes the loser hit P2002 and roll its whole ingest
        //   back, leaving no IngestedOrder row so a rebuild re-ingests it. Upgrade path: a
        //   partial unique index WHERE "depotId" IS NULL, then a raw ON CONFLICT here too.
        const existing = await tx.productDailyDemand.findMany({
          where: {
            productId: { in: products.map((p) => p.item.productId) },
            depotId: cmd.depotId,
            day,
          },
          select: { id: true, productId: true },
        });
        const idByProduct = new Map(existing.map((row) => [row.productId, row.id]));
        const updates = products.filter((p) => idByProduct.has(p.item.productId));
        if (updates.length > 0) {
          // Increments differ per product, so this is one UPDATE ... FROM (VALUES), the
          // same shape depot-service uses to release many reservations at once.
          await tx.$executeRaw(Prisma.sql`
            UPDATE "product_daily_demand" AS d
            SET "quantity" = d."quantity" + v."q",
                "orderCount" = d."orderCount" + v."c",
                "updatedAt" = NOW()
            FROM (VALUES ${Prisma.join(
              updates.map(
                (p) =>
                  Prisma.sql`(${idByProduct.get(p.item.productId)!}::uuid, ${p.quantity}::int, ${p.orders}::int)`,
              ),
            )}) AS v("id", "q", "c")
            WHERE d."id" = v."id"`);
        }
        const missing = products.filter((p) => !idByProduct.has(p.item.productId));
        if (missing.length > 0) {
          await tx.productDailyDemand.createMany({
            data: missing.map((p) => ({
              productId: p.item.productId,
              depotId: cmd.depotId,
              day,
              quantity: p.quantity,
              orderCount: p.orders,
            })),
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
      day: dateToDay(r.day),
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
        day: dateToDay(r.day),
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
    return rows.map((r) => ({ depotId: r.depotId, day: dateToDay(r.day), revenue: r.revenue }));
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
