import { Injectable } from '@nestjs/common';
import { depotWhere, nextCursor, pageArgs, readAllPages } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';
import { DeliveryStatus } from '../../domain/delivery-status';
import { ContactMethod, ContactState } from '../../domain/no-show';
import {
  CreateDeliveryData,
  CodBearing,
  DeliveredRow,
  DeliveryItem,
  DeliveryPingState,
  DeliveryQuery,
  DeliveryRecord,
  DeliveryRepository,
  DeliveryTimestamps,
  DepotCourierActivity,
  DepotDeliveredCount,
  DepotSlaStats,
  ProofRecord,
  ReportRange,
  SlaCandidate,
  SlaStats,
} from '../../application/ports/delivery.repository';
import { ReportRangeTooLargeError, StaleDeliveryStatusError } from '../../domain/errors';

/**
 * DB-2 bounds for the depot team report. The page is the middleware's own cap, so a normal
 * month is one query; the ceiling is a year of a busy depot, past which the report refuses
 * rather than answering with a slice of itself.
 */
const COURIER_ACTIVITY_PAGE = 500;
const MAX_COURIER_ACTIVITY_ROWS = 20_000;
import { PrismaService } from './prisma.service';

/**
 * Turns the status guard's "no row matched" into the courier's answer (H-5).
 *
 * On these writes P2025 only ever means `status: from` did not match — the delivery moved
 * under the caller. Left raw it would be a 500 on an ordinary double tap.
 */
function rejectStaleStatus(error: unknown): never {
  if ((error as { code?: string })?.code === 'P2025') {
    throw new StaleDeliveryStatusError();
  }
  throw error;
}

interface ProofRow {
  photoUrl: string;
  signatureUrl: string | null;
  sealIntact: boolean | null;
  recipientName: string;
  latitude: number;
  longitude: number;
  note: string | null;
  capturedAt: Date;
}

interface HistoryRow {
  status: string;
  changedBy: string | null;
  note: string | null;
  createdAt: Date;
}

interface DeliveryRow {
  id: string;
  orderId: string;
  orderNumber: string;
  driverId: string;
  depotId: string | null;
  status: string;
  destinationAddress: string;
  destinationLat: number | null;
  destinationLng: number | null;
  recipientPhone: string | null;
  customerId: string | null;
  items: Prisma.JsonValue | null;
  codAmount: number | null;
  notes: string | null;
  deliveryWindow: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  estimatedArrivalAt: Date | null;
  assignedAt: Date;
  pickedUpAt: Date | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  rescheduledFor: Date | null;
  rescheduleSlot: string | null;
  rescheduleNote: string | null;
  proof: ProofRow | null;
  history: HistoryRow[];
  createdAt: Date;
  updatedAt: Date;
}

// Active = occupies the driver (see domain isActive); mirrored here for the query.
const ACTIVE_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.PICKED_UP,
  DeliveryStatus.ON_DELIVERY,
];

const INCLUDE = {
  proof: true,
  history: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class DeliveryPrismaRepository implements DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: DeliveryRow): DeliveryRecord {
    return {
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      driverId: row.driverId,
      depotId: row.depotId,
      status: row.status as DeliveryStatus,
      destinationAddress: row.destinationAddress,
      destinationLat: row.destinationLat,
      destinationLng: row.destinationLng,
      recipientPhone: row.recipientPhone,
      customerId: row.customerId,
      items: (row.items as DeliveryItem[] | null) ?? null,
      codAmount: row.codAmount,
      notes: row.notes,
      deliveryWindow: row.deliveryWindow,
      lastLat: row.lastLat,
      lastLng: row.lastLng,
      lastLocationAt: row.lastLocationAt,
      estimatedArrivalAt: row.estimatedArrivalAt,
      assignedAt: row.assignedAt,
      pickedUpAt: row.pickedUpAt,
      startedAt: row.startedAt,
      deliveredAt: row.deliveredAt,
      failedAt: row.failedAt,
      failureReason: row.failureReason,
      rescheduledFor: row.rescheduledFor,
      rescheduleSlot: row.rescheduleSlot,
      rescheduleNote: row.rescheduleNote,
      proof: row.proof
        ? {
            photoUrl: row.proof.photoUrl,
            signatureUrl: row.proof.signatureUrl,
            sealIntact: row.proof.sealIntact,
            recipientName: row.proof.recipientName,
            latitude: row.proof.latitude,
            longitude: row.proof.longitude,
            note: row.proof.note,
            capturedAt: row.proof.capturedAt,
          }
        : null,
      history: row.history.map((h) => ({
        status: h.status as DeliveryStatus,
        changedBy: h.changedBy,
        note: h.note,
        createdAt: h.createdAt,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreateDeliveryData): Promise<DeliveryRecord> {
    const { items, ...rest } = data;
    const row = await this.prisma.delivery.create({
      data: {
        ...rest,
        // Prisma Json column: a JS null must be Prisma.JsonNull, not raw null.
        items: items ? (items as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        status: DeliveryStatus.ASSIGNED,
        history: { create: { status: DeliveryStatus.ASSIGNED } },
      },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<DeliveryRecord | null> {
    const row = await this.prisma.delivery.findUnique({ where: { id }, include: INCLUDE });
    return row ? this.toRecord(row) : null;
  }

  async findByOrder(orderId: string): Promise<DeliveryRecord | null> {
    const row = await this.prisma.delivery.findUnique({ where: { orderId }, include: INCLUDE });
    return row ? this.toRecord(row) : null;
  }

  async countActiveByDriver(driverId: string): Promise<number> {
    return this.prisma.delivery.count({
      where: { driverId, status: { in: ACTIVE_STATUSES } },
    });
  }

  async recordContactAttempt(
    deliveryId: string,
    driverId: string,
    method: ContactMethod,
    note: string | null,
  ): Promise<ContactState> {
    await this.prisma.contactAttempt.create({ data: { deliveryId, driverId, method, note } });
    return this.contactState(deliveryId);
  }

  async contactState(deliveryId: string): Promise<ContactState> {
    const [attempts, first] = await Promise.all([
      this.prisma.contactAttempt.count({ where: { deliveryId } }),
      this.prisma.contactAttempt.findFirst({
        where: { deliveryId },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return { attempts, firstAttemptAt: first?.createdAt ?? null };
  }

  async search(
    query: DeliveryQuery,
  ): Promise<{ items: DeliveryRecord[]; total: number; nextCursor: string | null }> {
    const where = {
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.depotIds ? { depotId: depotWhere(query.depotIds) } : {}),
      // `statuses` first: it is the narrower question, and a caller sending both means
      // the set, not the single value it had to send before the set existed.
      ...(query.statuses?.length
        ? { status: { in: [...query.statuses] } }
        : query.status
          ? { status: query.status }
          : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: INCLUDE,
        // `id` last so the cursor is unambiguous between rows assigned in the same tick.
        orderBy: [{ assignedAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.delivery.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
      nextCursor: nextCursor(rows, query.limit),
    };
  }

  async codBearingInWindow(driverId: string, from: Date, to: Date): Promise<CodBearing[]> {
    const rows = await this.prisma.delivery.findMany({
      where: {
        driverId,
        OR: [
          // The three ways a courier finishes with a delivery, each read from the timestamp
          // that ending actually writes. Only the first of these used to be here, and the
          // other two are where collected cash went missing (CA-4-03).
          { status: DeliveryStatus.DELIVERED, deliveredAt: { gte: from, lte: to } },
          { status: DeliveryStatus.FAILED, failedAt: { gte: from, lte: to } },
          {
            // RESCHEDULED has no completion column of its own — `rescheduledFor` is the
            // FUTURE slot the courier picked, not the moment they handed the job back. The
            // status-history row is the only exact record of when that happened, and
            // `updatedAt` is not a substitute: a later re-assignment moves it.
            status: DeliveryStatus.RESCHEDULED,
            history: {
              some: { status: DeliveryStatus.RESCHEDULED, createdAt: { gte: from, lte: to } },
            },
          },
        ],
      },
      select: { orderId: true, codAmount: true, status: true },
    });
    return rows.map((r) => ({
      orderId: r.orderId,
      codAmount: r.codAmount,
      status: r.status as DeliveryStatus,
    }));
  }

  async driverDeliveredInWindow(
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<DeliveredRow[]> {
    const rows = await this.prisma.delivery.findMany({
      where: { driverId, status: DeliveryStatus.DELIVERED, deliveredAt: { gte: from, lt: to } },
      select: { orderId: true, assignedAt: true, deliveredAt: true },
    });
    return rows.map((r) => ({
      orderId: r.orderId,
      assignedAt: r.assignedAt,
      deliveredAt: r.deliveredAt!,
    }));
  }

  async driverFailedCountInWindow(driverId: string, from: Date, to: Date): Promise<number> {
    return this.prisma.delivery.count({
      where: { driverId, failedAt: { gte: from, lt: to } },
    });
  }

  async depotDeliveredCountsInWindow(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<DepotDeliveredCount[]> {
    const rows = await this.prisma.delivery.groupBy({
      by: ['driverId'],
      where: { depotId, status: DeliveryStatus.DELIVERED, deliveredAt: { gte: from, lt: to } },
      _count: { _all: true },
    });
    return rows.map((r) => ({ driverId: r.driverId, count: r._count._all }));
  }

  async depotCourierActivityInWindow(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<DepotCourierActivity[]> {
    /*
     * DB-2 — this query had no `take` and no `orderBy`.
     *
     * Every PrismaService installs a middleware that caps a bound-less `findMany` at 500
     * rows (platform/query-bounds.ts). A depot doing 25 deliveries a day passes that on day
     * 20, so from then on the monthly team report was built from an ARBITRARY 500 of the
     * month's deliveries — arbitrary because nothing ordered them — and published the
     * courier ranking and SLA percentages computed off that slice as the month's figures.
     * The only trace was one warning line in a container log.
     *
     * Reports own their bound (that is what the middleware's own comment says), so this
     * pages by keyset until the window is exhausted and REFUSES a window too large to hold
     * rather than answering with part of it — the same rule the depot operational report
     * already follows.
     */
    const rows = await readAllPages(
      ({ take, cursor }) =>
        this.prisma.delivery.findMany({
          where: {
            depotId,
            OR: [{ deliveredAt: { gte: from, lt: to } }, { failedAt: { gte: from, lt: to } }],
          },
          select: {
            id: true,
            driverId: true,
            orderId: true,
            assignedAt: true,
            deliveredAt: true,
            failedAt: true,
          },
          orderBy: [{ id: 'asc' }],
          take,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      {
        pageSize: COURIER_ACTIVITY_PAGE,
        max: MAX_COURIER_ACTIVITY_ROWS,
        onOverflow: (): never => {
          throw new ReportRangeTooLargeError(MAX_COURIER_ACTIVITY_ROWS);
        },
      },
    );

    const grouped = new Map<string, DepotCourierActivity>();
    for (const row of rows) {
      const activity = grouped.get(row.driverId) ?? {
        driverId: row.driverId,
        delivered: [],
        failed: 0,
      };
      if (row.deliveredAt) {
        activity.delivered.push({
          orderId: row.orderId,
          assignedAt: row.assignedAt,
          deliveredAt: row.deliveredAt,
        });
      }
      if (row.failedAt) activity.failed += 1;
      grouped.set(row.driverId, activity);
    }
    return [...grouped.values()];
  }

  async findPingState(id: string): Promise<DeliveryPingState | null> {
    // Columns only — the ping path never renders history or proof (audit S-17).
    const row = await this.prisma.delivery.findUnique({
      where: { id },
      select: {
        id: true,
        driverId: true,
        status: true,
        depotId: true,
        destinationLat: true,
        destinationLng: true,
        lastLat: true,
        lastLng: true,
      },
    });
    return row ? { ...row, status: row.status as DeliveryStatus } : null;
  }

  async updateLocation(
    id: string,
    lat: number,
    lng: number,
    estimatedArrivalAt?: Date,
  ): Promise<DeliveryRecord> {
    const row = await this.prisma.delivery.update({
      where: { id },
      data: {
        lastLat: lat,
        lastLng: lng,
        lastLocationAt: new Date(),
        ...(estimatedArrivalAt ? { estimatedArrivalAt } : {}),
      },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async applyStatus(
    id: string,
    from: DeliveryStatus,
    status: DeliveryStatus,
    timestamps: DeliveryTimestamps,
    changedBy: string | null,
    note: string | null,
  ): Promise<DeliveryRecord> {
    const row = await this.prisma.delivery
      .update({
        where: { id, status: from },
        data: {
          status,
          ...timestamps,
          history: { create: { status, changedBy, note } },
        },
        include: INCLUDE,
      })
      .catch(rejectStaleStatus);
    return this.toRecord(row);
  }

  async reassign(
    id: string,
    driverId: string,
    changedBy: string,
    note: string | null,
  ): Promise<DeliveryRecord> {
    // Second attempt on the same row: back to ASSIGNED under (possibly) a new driver, with
    // the previous attempt's progress timestamps cleared so the app shows a fresh run.
    const row = await this.prisma.delivery.update({
      where: { id },
      data: {
        driverId,
        status: DeliveryStatus.ASSIGNED,
        pickedUpAt: null,
        startedAt: null,
        estimatedArrivalAt: null,
        history: { create: { status: DeliveryStatus.ASSIGNED, changedBy, note } },
      },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async completeWithProof(
    id: string,
    from: DeliveryStatus,
    proof: Omit<ProofRecord, 'capturedAt'>,
    changedBy: string,
    capturedAt: Date,
  ): Promise<DeliveryRecord> {
    const row = await this.prisma.delivery
      .update({
        where: { id, status: from },
        data: {
          status: DeliveryStatus.DELIVERED,
          deliveredAt: capturedAt,
          proof: { create: { ...proof, capturedAt } },
          history: { create: { status: DeliveryStatus.DELIVERED, changedBy } },
        },
        include: INCLUDE,
      })
      .catch(rejectStaleStatus);
    return this.toRecord(row);
  }

  async erasePerson(customerId: string, phone: string | null): Promise<number> {
    // OR on the phone as well as the id: a delivery created before the customer registered
    // carries the number and no id, and that is the row the audit counted.
    const match = phone
      ? [{ customerId }, { recipientPhone: phone }]
      : [{ customerId }];
    const [deliveries, proofs] = await this.prisma.$transaction([
      this.prisma.delivery.updateMany({
        where: { OR: match },
        data: { recipientPhone: null, notes: null },
      }),
      // The proof's recipient NAME only. Photo, signature and GPS belong to the 365-day
      // retention sweep, which deletes the objects too — racing it here would leave rows
      // pointing at files nobody deleted.
      this.prisma.proofOfDelivery.updateMany({
        where: { delivery: { OR: match } },
        data: { recipientName: '' },
      }),
    ]);
    return deliveries.count + proofs.count;
  }

  async purgeProofsBefore(cutoff: Date): Promise<{ count: number; urls: string[] }> {
    // Read the URLs before the rows go: once they are deleted there is nothing left to say
    // which objects in the bucket belonged to them (H-22).
    const doomed = await this.prisma.proofOfDelivery.findMany({
      where: { capturedAt: { lt: cutoff } },
      select: { photoUrl: true, signatureUrl: true },
    });
    const { count } = await this.prisma.proofOfDelivery.deleteMany({
      where: { capturedAt: { lt: cutoff } },
    });
    const urls = doomed.flatMap((p) =>
      [p.photoUrl, p.signatureUrl].filter((u): u is string => !!u),
    );
    return { count, urls };
  }

  async slaStats(
    range: ReportRange,
    thresholdMinutes: number,
    depotIds?: string[],
  ): Promise<SlaStats> {
    const scoped = depotIds !== undefined && depotIds.length > 0;
    const conds: Prisma.Sql[] = [Prisma.sql`"deliveredAt" IS NOT NULL`];
    if (range.from) conds.push(Prisma.sql`"deliveredAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`"deliveredAt" < ${range.to}`);
    if (scoped) conds.push(Prisma.sql`"depotId" = ANY(${depotIds}::uuid[])`);
    const [agg] = await this.prisma.$queryRaw<
      { total: bigint; ontime: bigint; summinutes: number | null }[]
    >(Prisma.sql`
      SELECT COUNT(*)::bigint AS total,
             COALESCE(SUM(
               CASE WHEN EXTRACT(EPOCH FROM ("deliveredAt" - "assignedAt")) / 60 <= ${thresholdMinutes}
                    THEN 1 ELSE 0 END
             ), 0)::bigint AS ontime,
             COALESCE(SUM(EXTRACT(EPOCH FROM ("deliveredAt" - "assignedAt")) / 60), 0) AS summinutes
      FROM "deliveries"
      WHERE ${Prisma.join(conds, ' AND ')}
    `);
    const failedCount = await this.prisma.delivery.count({
      where: {
        failedAt: {
          not: null,
          ...(range.from ? { gte: range.from } : {}),
          ...(range.to ? { lt: range.to } : {}),
        },
        ...(scoped ? { depotId: { in: depotIds } } : {}),
      },
    });
    const totalDelivered = Number(agg.total);
    const onTime = Number(agg.ontime);
    return {
      totalDelivered,
      onTime,
      breached: totalDelivered - onTime,
      sumMinutes: Number(agg.summinutes ?? 0),
      failedCount,
    };
  }

  async slaStatsByDepot(
    range: ReportRange,
    thresholdMinutes: number,
  ): Promise<DepotSlaStats[]> {
    const conds: Prisma.Sql[] = [
      Prisma.sql`"deliveredAt" IS NOT NULL`,
      Prisma.sql`"depotId" IS NOT NULL`,
    ];
    if (range.from) conds.push(Prisma.sql`"deliveredAt" >= ${range.from}`);
    if (range.to) conds.push(Prisma.sql`"deliveredAt" < ${range.to}`);
    const rows = await this.prisma.$queryRaw<
      { depotid: string; total: bigint; ontime: bigint; summinutes: number | null }[]
    >(Prisma.sql`
      SELECT "depotId" AS depotid,
             COUNT(*)::bigint AS total,
             COALESCE(SUM(
               CASE WHEN EXTRACT(EPOCH FROM ("deliveredAt" - "assignedAt")) / 60 <= ${thresholdMinutes}
                    THEN 1 ELSE 0 END
             ), 0)::bigint AS ontime,
             COALESCE(SUM(EXTRACT(EPOCH FROM ("deliveredAt" - "assignedAt")) / 60), 0) AS summinutes
      FROM "deliveries"
      WHERE ${Prisma.join(conds, ' AND ')}
      GROUP BY "depotId"
    `);
    return rows.map((r) => {
      const totalDelivered = Number(r.total);
      const onTime = Number(r.ontime);
      return {
        depotId: r.depotid,
        totalDelivered,
        onTime,
        breached: totalDelivered - onTime,
        sumMinutes: Number(r.summinutes ?? 0),
      };
    });
  }

  async findUnalertedInFlight(assignedBefore: Date, limit: number): Promise<SlaCandidate[]> {
    return this.prisma.delivery.findMany({
      where: {
        status: { in: [DeliveryStatus.ASSIGNED, DeliveryStatus.PICKED_UP, DeliveryStatus.ON_DELIVERY] },
        slaAlertedAt: null,
        assignedAt: { lt: assignedBefore },
      },
      // Oldest first: when a backlog is bigger than one batch, the most overdue
      // deliveries are the ones that get called in rather than the ones that fit.
      orderBy: { assignedAt: 'asc' },
      take: limit,
      select: { id: true, orderNumber: true, depotId: true, assignedAt: true },
    });
  }

  async markSlaAlerted(id: string, at: Date): Promise<void> {
    await this.prisma.delivery.update({ where: { id }, data: { slaAlertedAt: at } });
  }
}
