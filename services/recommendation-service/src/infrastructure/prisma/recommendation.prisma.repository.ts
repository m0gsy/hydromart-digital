import { Injectable } from '@nestjs/common';

import { PurchaseRow } from '../../domain/reorder';
import { CoBuyRow } from '../../domain/co-buy';
import { DailyRow } from '../../domain/trending';
import { IngestCommand, RecommendationRepository } from '../../application/ports/recommendation.repository';
import { PrismaService } from './prisma.service';

/** Derives the UTC-midnight calendar day used for daily-sales bucketing. */
function utcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

@Injectable()
export class RecommendationPrismaRepository implements RecommendationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasIngested(orderId: string): Promise<boolean> {
    const row = await this.prisma.ingestedOrder.findUnique({ where: { orderId } });
    return row !== null;
  }

  async applyIngest(cmd: IngestCommand): Promise<void> {
    const day = utcDay(cmd.at);
    await this.prisma.$transaction(async (tx) => {
      for (const item of cmd.items) {
        await tx.customerProductPurchase.upsert({
          where: { customerId_productId: { customerId: cmd.customerId, productId: item.productId } },
          create: {
            customerId: cmd.customerId,
            productId: item.productId,
            purchaseCount: 1,
            lastPurchasedAt: cmd.at,
          },
          update: { purchaseCount: { increment: 1 }, lastPurchasedAt: cmd.at },
        });

        await tx.productRef.upsert({
          where: { productId: item.productId },
          create: { productId: item.productId, name: item.productName, sku: item.sku, unit: item.unit, buyCount: 1 },
          update: { name: item.productName, sku: item.sku, unit: item.unit, buyCount: { increment: 1 } },
        });

        // Prisma's compound-unique where input requires a non-null depotId, but depotId is
        // nullable here (order not tied to a depot), so upsert-by-compound-key isn't typeable.
        // Find-then-write instead; safe within one interactive $transaction for the common case.
        // ponytail: two CONCURRENT ingests racing on the same product+day expose two behaviours,
        //   both rare (needs same-product/same-day completions within the same instant) and both
        //   recoverable — the live caller is fail-OPEN and, since no IngestedOrder row is written
        //   on a rolled-back ingest, a later `rebuild` re-ingests the lost order:
        //   (a) depotId = null: Postgres unique treats NULL != NULL, so the @@unique doesn't
        //       collapse the rows — both findFirst miss and both create. This does NOT undercount
        //       trending (rankTrending re-sums every row per productId, so split rows still total
        //       correctly); the only effect is a few extra rows.
        //   (b) non-null depotId: the @@unique DOES enforce, so the loser hits P2002 and its WHOLE
        //       ingest transaction rolls back (that order left un-ingested until a rebuild).
        // Upgrade path if either matters: a partial unique index `WHERE depot_id IS NULL` plus a
        // raw `ON CONFLICT ... DO UPDATE` upsert, or a depot sentinel to make the key non-null.
        const existingDaily = await tx.productDailySales.findFirst({
          where: { productId: item.productId, depotId: cmd.depotId, day },
        });
        if (existingDaily) {
          await tx.productDailySales.update({
            where: { id: existingDaily.id },
            data: { count: { increment: 1 } },
          });
        } else {
          await tx.productDailySales.create({
            data: { productId: item.productId, depotId: cmd.depotId, day, count: 1 },
          });
        }
      }

      // Every unordered pair of distinct products in the order gets a symmetric co-buy bump.
      for (let i = 0; i < cmd.items.length; i += 1) {
        for (let j = i + 1; j < cmd.items.length; j += 1) {
          const a = cmd.items[i];
          const b = cmd.items[j];
          if (a.productId === b.productId) continue; // same product twice in the order: no self co-buy

          await tx.productCoBuy.upsert({
            where: { productId_relatedProductId: { productId: a.productId, relatedProductId: b.productId } },
            create: { productId: a.productId, relatedProductId: b.productId, coCount: 1 },
            update: { coCount: { increment: 1 } },
          });
          await tx.productCoBuy.upsert({
            where: { productId_relatedProductId: { productId: b.productId, relatedProductId: a.productId } },
            create: { productId: b.productId, relatedProductId: a.productId, coCount: 1 },
            update: { coCount: { increment: 1 } },
          });
        }
      }

      await tx.ingestedOrder.create({ data: { orderId: cmd.orderId } });
    });
  }

  async reorderRows(customerId: string): Promise<PurchaseRow[]> {
    const rows = await this.prisma.customerProductPurchase.findMany({ where: { customerId } });
    return rows.map((r) => ({ productId: r.productId, purchaseCount: r.purchaseCount, lastPurchasedAt: r.lastPurchasedAt }));
  }

  async relatedRows(productId: string): Promise<{ rows: CoBuyRow[]; baseCount: number }> {
    const [rows, ref] = await Promise.all([
      this.prisma.productCoBuy.findMany({ where: { productId } }),
      this.prisma.productRef.findUnique({ where: { productId } }),
    ]);
    return {
      rows: rows.map((r) => ({ relatedProductId: r.relatedProductId, coCount: r.coCount })),
      baseCount: ref?.buyCount ?? 0,
    };
  }

  async trendingRows(depotId: string | null, fromDay: Date): Promise<DailyRow[]> {
    const rows = await this.prisma.productDailySales.findMany({
      where: { day: { gte: fromDay }, ...(depotId ? { depotId } : {}) },
    });
    return rows.map((r) => ({ productId: r.productId, day: r.day, count: r.count }));
  }

  async productRefs(ids: string[]): Promise<Map<string, { name: string; sku: string; unit: string }>> {
    const rows = await this.prisma.productRef.findMany({ where: { productId: { in: ids } } });
    return new Map(rows.map((r) => [r.productId, { name: r.name, sku: r.sku, unit: r.unit }]));
  }
}
