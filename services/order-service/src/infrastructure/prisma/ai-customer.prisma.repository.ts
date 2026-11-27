import { Injectable } from '@nestjs/common';

import { OrderStatus as DbOrderStatus, Prisma } from '../../../prisma/generated/client';
import {
  AiCustomerRepository,
  AiSpan,
  AreaPoints,
  CohortCell,
  CustomerSegmentStats,
  CustomerWindowStats,
  RatingStats,
  RefillSplitStats,
  SegmentThresholds,
} from '../../application/ports/ai-customer.repository';
import { ANONYMOUS_CUSTOMER_ID } from '../../domain/anonymous';
import { PrismaService } from './prisma.service';

const VOID_LIKE = [DbOrderStatus.CANCELLED, DbOrderStatus.VOIDED];
const IN_FLIGHT = [
  DbOrderStatus.CREATED,
  DbOrderStatus.CONFIRMED,
  DbOrderStatus.PREPARING,
  DbOrderStatus.DRIVER_ASSIGNED,
  DbOrderStatus.PICKED_UP,
  DbOrderStatus.ON_DELIVERY,
];

/** An order that counts: neither cancelled nor voided. Aliased `o`, so it survives a join. */
const COUNTS = Prisma.sql`o."status" NOT IN (${Prisma.join(VOID_LIKE.map((s) => Prisma.sql`${s}::"OrderStatus"`))})`;
const NAMED = Prisma.sql`o."customerId" <> ${ANONYMOUS_CUSTOMER_ID}::uuid`;

/**
 * `sp` = the spans as a table. The columns are naive timestamps holding UTC, so the span's
 * instants are converted and the bare column is compared (`o."createdAt" >= <converted>`), which
 * keeps (depotId, createdAt) usable.
 */
const spansCte = (spans: readonly AiSpan[]): Prisma.Sql =>
  Prisma.sql`sp AS (
    SELECT * FROM unnest(
      ${spans.map((s) => s.depotId)}::uuid[],
      ${spans.map((s) => s.from.toISOString())}::timestamptz[],
      ${spans.map((s) => s.to.toISOString())}::timestamptz[]
    ) AS t("depotId", "fromAt", "toAt")
  )`;
const IN_SPAN = Prisma.sql`o."depotId" = sp."depotId"
  AND o."createdAt" >= (sp."fromAt" AT TIME ZONE 'UTC')
  AND o."createdAt" < (sp."toAt" AT TIME ZONE 'UTC')`;

/** The orders that count in the spans, one row each. */
const winCte = (spans: readonly AiSpan[]): Prisma.Sql => Prisma.sql`${spansCte(spans)},
  win AS (
    SELECT o."id", o."customerId", o."depotId", o."createdAt"
    FROM sp JOIN "orders" o ON ${IN_SPAN}
    WHERE ${COUNTS} AND ${NAMED}
  ),
  buyers AS (SELECT DISTINCT "customerId" FROM win),
  firsts AS (
    SELECT DISTINCT ON (o."customerId") o."id", o."customerId", o."createdAt"
    FROM "orders" o JOIN buyers b ON b."customerId" = o."customerId"
    WHERE ${COUNTS}
    ORDER BY o."customerId", o."createdAt", o."id"
  )`;

const n = (v: bigint | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));

/** HD-6 H3: the raw-SQL reads behind the AI read API's customer and gallon metrics. */
@Injectable()
export class AiCustomerPrismaRepository implements AiCustomerRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HD-20c: the pins of the counted, named orders of the spans (the same COUNTS and NAMED as the customer
   * metrics), one row per customer per distinct pin rounded to 4 decimals
   * (an order with no pin, or half a pin, is a row with a null pin, so a customer with and without pins is still one k). The customer id is turned into a small number `k`
   * here and never leaves; the pin is the order's own delivery snapshot.
   */
  async areaPoints(spans: readonly AiSpan[], limit: number): Promise<AreaPoints | null> {
    const rows = await this.prisma.$queryRaw<
      { customerId: string; latitude: number | null; longitude: number | null; orders: bigint; galon: bigint }[]
    >(Prisma.sql`
      WITH ${spansCte(spans)},
      win AS (
        -- 4 decimals is about 11 m: the precise pin never leaves order-service; a half pin is no pin
        SELECT o."id", o."customerId",
               CASE WHEN o."latitude" IS NOT NULL AND o."longitude" IS NOT NULL THEN ROUND(o."latitude"::numeric, 4)::float8 END AS "latitude",
               CASE WHEN o."latitude" IS NOT NULL AND o."longitude" IS NOT NULL THEN ROUND(o."longitude"::numeric, 4)::float8 END AS "longitude"
        FROM sp JOIN "orders" o ON ${IN_SPAN}
        WHERE ${COUNTS} AND ${NAMED}
      ),
      gal AS (
        SELECT i."orderId", SUM(i."quantity") AS "q"
        FROM "order_items" i WHERE i."isGallon" = true AND i."orderId" IN (SELECT "id" FROM win)
        GROUP BY i."orderId"
      )
      SELECT w."customerId" AS "customerId", w."latitude" AS "latitude", w."longitude" AS "longitude",
             COUNT(*)::bigint AS "orders", COALESCE(SUM(g."q"), 0)::bigint AS "galon"
      FROM win w LEFT JOIN gal g ON g."orderId" = w."id"
      GROUP BY w."customerId", w."latitude", w."longitude"
      LIMIT ${limit + 1}
    `);
    if (rows.length > limit) return null;
    const keys = new Map<string, number>();
    const points = rows.map((r) => {
      if (!keys.has(r.customerId)) keys.set(r.customerId, keys.size);
      return { k: keys.get(r.customerId) as number, lat: r.latitude, lng: r.longitude, orders: n(r.orders), galon: n(r.galon) };
    });
    return { points };
  }

  async customerWindow(spans: readonly AiSpan[], periodFrom: Date): Promise<CustomerWindowStats> {
    const [[head], perDepot] = await Promise.all([
      this.prisma.$queryRaw<{ active: bigint; newCustomers: bigint; repeat: bigint }[]>(Prisma.sql`
        WITH ${winCte(spans)}
        SELECT (SELECT COUNT(*) FROM buyers)::bigint AS "active",
               (SELECT COUNT(*) FROM firsts f WHERE f."id" IN (SELECT "id" FROM win))::bigint AS "newCustomers",
               (SELECT COUNT(*) FROM buyers b WHERE EXISTS (
                  SELECT 1 FROM "orders" o
                  WHERE o."customerId" = b."customerId" AND ${COUNTS}
                    AND o."createdAt" < (${periodFrom.toISOString()}::timestamptz AT TIME ZONE 'UTC')
               ))::bigint AS "repeat"
      `),
      this.prisma.$queryRaw<{ depotId: string; customers: bigint }[]>(Prisma.sql`
        WITH ${winCte(spans)},
        dfirst AS (
          SELECT DISTINCT ON (o."customerId", o."depotId") o."id", o."depotId"
          FROM "orders" o
          JOIN (SELECT DISTINCT "customerId", "depotId" FROM win) w
            ON w."customerId" = o."customerId" AND w."depotId" = o."depotId"
          WHERE ${COUNTS}
          ORDER BY o."customerId", o."depotId", o."createdAt", o."id"
        )
        SELECT d."depotId" AS "depotId", COUNT(*)::bigint AS "customers"
        FROM dfirst d WHERE d."id" IN (SELECT "id" FROM win)
        GROUP BY d."depotId"
      `),
    ]);
    return {
      active: n(head?.active),
      newCustomers: n(head?.newCustomers),
      repeat: n(head?.repeat),
      newAtDepot: perDepot.map((r) => ({ depotId: r.depotId, customers: n(r.customers) })),
    };
  }

  async customerCohorts(spans: readonly AiSpan[], timeZone: string): Promise<CohortCell[]> {
    const rows = await this.prisma.$queryRaw<{ cohort: string; monthIndex: number; customers: bigint }[]>(Prisma.sql`
      WITH ${winCte(spans)},
      members AS (
        SELECT f."customerId",
               date_trunc('month', f."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}) AS cohort
        FROM firsts f WHERE f."id" IN (SELECT "id" FROM win)
      ),
      activity AS (
        SELECT DISTINCT w."customerId",
               date_trunc('month', w."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}) AS active_month
        FROM win w
      )
      SELECT to_char(m.cohort, 'YYYY-MM') AS "cohort",
             ((EXTRACT(YEAR FROM a.active_month) - EXTRACT(YEAR FROM m.cohort)) * 12
              + (EXTRACT(MONTH FROM a.active_month) - EXTRACT(MONTH FROM m.cohort)))::int AS "monthIndex",
             COUNT(DISTINCT m."customerId")::bigint AS "customers"
      FROM members m
      JOIN activity a ON a."customerId" = m."customerId" AND a.active_month >= m.cohort
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    return rows.map((r) => ({ cohort: r.cohort, monthIndex: Number(r.monthIndex), customers: n(r.customers) }));
  }

  async ratingStats(spans: readonly AiSpan[]): Promise<RatingStats> {
    const [row] = await this.prisma.$queryRaw<{ reviews: bigint; ratingSum: bigint | null; reviewers: bigint }[]>(Prisma.sql`
      WITH ${spansCte(spans)}
      SELECT COUNT(*)::bigint AS "reviews",
             COALESCE(SUM(r."rating"), 0)::bigint AS "ratingSum",
             COUNT(DISTINCT o."customerId")::bigint AS "reviewers"
      FROM sp
      JOIN "orders" o ON ${IN_SPAN}
      JOIN "order_reviews" r ON r."orderId" = o."id"
      WHERE ${NAMED}
    `);
    return { reviews: n(row?.reviews), ratingSum: n(row?.ratingSum), reviewers: n(row?.reviewers) };
  }

  async customerSegments(depotIds: readonly string[], at: SegmentThresholds): Promise<CustomerSegmentStats> {
    const [row] = await this.prisma.$queryRaw<{ active: bigint; atRisk: bigint; inactive: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE l."last" >= (${at.activeSince.toISOString()}::timestamptz AT TIME ZONE 'UTC'))::bigint AS "active",
             COUNT(*) FILTER (WHERE l."last" < (${at.activeSince.toISOString()}::timestamptz AT TIME ZONE 'UTC')
                                AND l."last" >= (${at.riskSince.toISOString()}::timestamptz AT TIME ZONE 'UTC'))::bigint AS "atRisk",
             COUNT(*) FILTER (WHERE l."last" < (${at.riskSince.toISOString()}::timestamptz AT TIME ZONE 'UTC'))::bigint AS "inactive"
      FROM (
        SELECT o."customerId", MAX(o."createdAt") AS "last"
        FROM "orders" o
        WHERE o."depotId" = ANY(${[...depotIds]}::uuid[]) AND ${COUNTS} AND ${NAMED}
          AND o."createdAt" < (${at.until.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        GROUP BY o."customerId"
      ) l
    `);
    return { active: n(row?.active), atRisk: n(row?.atRisk), inactive: n(row?.inactive) };
  }

  async gallonsSold(spans: readonly AiSpan[]): Promise<{ depotId: string; gallons: number }[]> {
    const rows = await this.prisma.$queryRaw<{ depotId: string; gallons: bigint | null }[]>(Prisma.sql`
      WITH ${spansCte(spans)}
      SELECT o."depotId" AS "depotId", COALESCE(SUM(i."quantity"), 0)::bigint AS "gallons"
      FROM sp
      JOIN "orders" o ON ${IN_SPAN}
      JOIN "order_items" i ON i."orderId" = o."id"
      WHERE o."status" IN (${Prisma.join([DbOrderStatus.DELIVERED, DbOrderStatus.COMPLETED].map((s) => Prisma.sql`${s}::"OrderStatus"`))})
        AND i."isGallon" = true
      GROUP BY o."depotId"
      ORDER BY o."depotId"
    `);
    return rows.map((r) => ({ depotId: r.depotId, gallons: n(r.gallons) }));
  }

  async refillSplit(spans: readonly AiSpan[]): Promise<RefillSplitStats> {
    const [row] = await this.prisma.$queryRaw<{ refill: bigint; partial: bigint; beli: bigint; notAsked: bigint }[]>(Prisma.sql`
      WITH ${spansCte(spans)},
      per AS (
        SELECT o."id", o."emptiesReturned" AS "empties", SUM(i."quantity") AS "gallons"
        FROM sp
        JOIN "orders" o ON ${IN_SPAN}
        JOIN "order_items" i ON i."orderId" = o."id" AND i."isGallon" = true
        WHERE o."isWalkIn" = true AND ${COUNTS}
        GROUP BY o."id", o."emptiesReturned"
      )
      SELECT COUNT(*) FILTER (WHERE "empties" IS NULL)::bigint AS "notAsked",
             COUNT(*) FILTER (WHERE "empties" >= "gallons")::bigint AS "refill",
             COUNT(*) FILTER (WHERE "empties" > 0 AND "empties" < "gallons")::bigint AS "partial",
             COUNT(*) FILTER (WHERE "empties" = 0)::bigint AS "beli"
      FROM per WHERE "gallons" > 0
    `);
    return { refill: n(row?.refill), partial: n(row?.partial), beli: n(row?.beli), notAsked: n(row?.notAsked) };
  }

  async cancelledBeforeDeparture(spans: readonly AiSpan[]): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      WITH ${spansCte(spans)}
      SELECT COUNT(*)::bigint AS "n"
      FROM sp
      JOIN "orders" o ON o."depotId" = sp."depotId"
        AND o."statusChangedAt" >= (sp."fromAt" AT TIME ZONE 'UTC')
        AND o."statusChangedAt" < (sp."toAt" AT TIME ZONE 'UTC')
      WHERE o."status" = ${DbOrderStatus.CANCELLED}::"OrderStatus" AND o."isWalkIn" = false
        AND NOT EXISTS (
          SELECT 1 FROM "order_status_history" h
          WHERE h."orderId" = o."id"
            AND h."status" IN (${DbOrderStatus.PICKED_UP}::"OrderStatus", ${DbOrderStatus.ON_DELIVERY}::"OrderStatus")
        )
    `);
    return n(row?.n);
  }

  async liveByStatus(depotIds: readonly string[]): Promise<{ status: string; count: number }[]> {
    if (depotIds.length === 0) return [];
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { status: { in: IN_FLIGHT }, depotId: { in: [...depotIds] }, isWalkIn: false },
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }
}
