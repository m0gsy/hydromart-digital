import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import { DeliveryStatus } from '../../domain/delivery-status';
import {
  CreateDeliveryData,
  DeliveryQuery,
  DeliveryRecord,
  DeliveryRepository,
  DeliveryTimestamps,
  ProofRecord,
  ReportRange,
  SlaStats,
} from '../../application/ports/delivery.repository';
import { PrismaService } from './prisma.service';

interface ProofRow {
  photoUrl: string;
  signatureUrl: string;
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
  lastLat: number | null;
  lastLng: number | null;
  lastLocationAt: Date | null;
  assignedAt: Date;
  pickedUpAt: Date | null;
  startedAt: Date | null;
  deliveredAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
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
      lastLat: row.lastLat,
      lastLng: row.lastLng,
      lastLocationAt: row.lastLocationAt,
      assignedAt: row.assignedAt,
      pickedUpAt: row.pickedUpAt,
      startedAt: row.startedAt,
      deliveredAt: row.deliveredAt,
      failedAt: row.failedAt,
      failureReason: row.failureReason,
      proof: row.proof
        ? {
            photoUrl: row.proof.photoUrl,
            signatureUrl: row.proof.signatureUrl,
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
    const row = await this.prisma.delivery.create({
      data: {
        ...data,
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

  async search(query: DeliveryQuery): Promise<{ items: DeliveryRecord[]; total: number }> {
    const where = {
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.delivery.findMany({
        where,
        include: INCLUDE,
        orderBy: { assignedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.delivery.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
  }

  async updateLocation(id: string, lat: number, lng: number): Promise<DeliveryRecord> {
    const row = await this.prisma.delivery.update({
      where: { id },
      data: { lastLat: lat, lastLng: lng, lastLocationAt: new Date() },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async applyStatus(
    id: string,
    status: DeliveryStatus,
    timestamps: DeliveryTimestamps,
    changedBy: string | null,
    note: string | null,
  ): Promise<DeliveryRecord> {
    const row = await this.prisma.delivery.update({
      where: { id },
      data: {
        status,
        ...timestamps,
        history: { create: { status, changedBy, note } },
      },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async completeWithProof(
    id: string,
    proof: Omit<ProofRecord, 'capturedAt'>,
    changedBy: string,
  ): Promise<DeliveryRecord> {
    const row = await this.prisma.delivery.update({
      where: { id },
      data: {
        status: DeliveryStatus.DELIVERED,
        deliveredAt: new Date(),
        proof: { create: proof },
        history: { create: { status: DeliveryStatus.DELIVERED, changedBy } },
      },
      include: INCLUDE,
    });
    return this.toRecord(row);
  }

  async purgeProofsBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.proofOfDelivery.deleteMany({
      where: { capturedAt: { lt: cutoff } },
    });
    return count;
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
}
