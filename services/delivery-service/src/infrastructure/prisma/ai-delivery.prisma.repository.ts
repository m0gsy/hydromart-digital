import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  AiDeliveredStats,
  AiDeliveryRepository,
  AiFailedStats,
  AiGradedSpan,
  AiSpan,
} from '../../application/ports/ai-delivery.repository';
import { DeliveryStatus } from '../../domain/delivery-status';
import { NO_SHOW_REASON } from '../../domain/no-show';
import { PrismaService } from './prisma.service';

const n = (v: bigint | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));

/**
 * `sp` = the spans as a table. The columns are naive timestamps holding UTC, so the span's
 * instants are converted and the bare column is compared, which keeps the (depotId, ...) indexes usable.
 */
const spansCte = (spans: readonly (AiSpan & { thresholdMinutes?: number })[]): Prisma.Sql =>
  Prisma.sql`sp AS (
    SELECT * FROM unnest(
      ${spans.map((s) => s.depotId)}::uuid[],
      ${spans.map((s) => s.from.toISOString())}::timestamptz[],
      ${spans.map((s) => s.to.toISOString())}::timestamptz[],
      ${spans.map((s) => s.thresholdMinutes ?? 0)}::int[]
    ) AS t("depotId", "fromAt", "toAt", "threshold")
  )`;
const within = (column: Prisma.Sql): Prisma.Sql => Prisma.sql`d."depotId" = sp."depotId"
  AND ${column} >= (sp."fromAt" AT TIME ZONE 'UTC')
  AND ${column} < (sp."toAt" AT TIME ZONE 'UTC')`;

/** HD-6 H3: the raw-SQL reads behind the AI read API's delivery metrics. */
@Injectable()
export class AiDeliveryPrismaRepository implements AiDeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async deliveredStats(spans: readonly AiGradedSpan[]): Promise<AiDeliveredStats> {
    // The same clock and fallback as slaStats: the stored verdict where there is one, else the
    // minutes from the clock's start (a customer reschedule restarts it) against the threshold.
    const minutes = Prisma.sql`EXTRACT(EPOCH FROM (d."deliveredAt" - COALESCE(d."slaStartedAt", d."assignedAt"))) / 60`;
    const [row] = await this.prisma.$queryRaw<
      { delivered: bigint; onTime: bigint | null; stored: bigint; median: number | null }[]
    >(Prisma.sql`
      WITH ${spansCte(spans)}
      SELECT COUNT(*)::bigint AS "delivered",
             COALESCE(SUM(CASE WHEN COALESCE(d."slaOnTime", ${minutes} <= sp."threshold") THEN 1 ELSE 0 END), 0)::bigint AS "onTime",
             COUNT(d."slaOnTime")::bigint AS "stored",
             percentile_cont(0.5) WITHIN GROUP (ORDER BY ${minutes}) AS "median"
      FROM sp JOIN "deliveries" d ON ${within(Prisma.sql`d."deliveredAt"`)}
    `);
    // Distinct couriers over deliveries AND failures: a courier who only failed in the window is a courier too.
    const [people] = await this.prisma.$queryRaw<{ couriers: bigint }[]>(Prisma.sql`
      WITH ${spansCte(spans)}
      SELECT COUNT(*)::bigint AS "couriers" FROM (
        SELECT d."driverId" FROM sp JOIN "deliveries" d ON ${within(Prisma.sql`d."deliveredAt"`)}
        UNION
        SELECT d."driverId" FROM sp JOIN "deliveries" d ON ${within(Prisma.sql`d."failedAt"`)}
      ) c
    `);
    return {
      delivered: n(row?.delivered),
      onTime: n(row?.onTime),
      storedVerdicts: n(row?.stored),
      medianMinutes: row?.median == null ? null : Number(row.median),
      couriers: n(people?.couriers),
    };
  }

  async failedStats(spans: readonly AiSpan[]): Promise<AiFailedStats> {
    const [[failed], [rescheduled]] = await Promise.all([
      this.prisma.$queryRaw<{ failed: bigint; noShow: bigint }[]>(Prisma.sql`
        WITH ${spansCte(spans)}
        SELECT COUNT(*)::bigint AS "failed",
               COUNT(*) FILTER (WHERE d."failureReason" = ${NO_SHOW_REASON})::bigint AS "noShow"
        FROM sp JOIN "deliveries" d ON ${within(Prisma.sql`d."failedAt"`)}
      `),
      this.prisma.$queryRaw<{ rescheduled: bigint }[]>(Prisma.sql`
        WITH ${spansCte(spans)}
        SELECT COUNT(*)::bigint AS "rescheduled"
        FROM sp
        JOIN "deliveries" d ON d."depotId" = sp."depotId"
        JOIN "delivery_status_history" h ON h."deliveryId" = d."id"
        WHERE h."status" = ${DeliveryStatus.RESCHEDULED}::"DeliveryStatus"
          AND h."createdAt" >= (sp."fromAt" AT TIME ZONE 'UTC')
          AND h."createdAt" < (sp."toAt" AT TIME ZONE 'UTC')
      `),
    ]);
    return { failed: n(failed?.failed), noShow: n(failed?.noShow), rescheduled: n(rescheduled?.rescheduled) };
  }
}
