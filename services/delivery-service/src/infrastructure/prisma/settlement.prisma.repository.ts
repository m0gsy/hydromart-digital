import { Injectable } from '@nestjs/common';

import { SettlementStatus } from '../../domain/settlement';
import {
  CourierShortfall,
  CreateSettlementData,
  OperatorSettlementStats,
  ResolveSettlementPatch,
  SettlementQuery,
  SettlementRecord,
  SettlementRepository,
} from '../../application/ports/settlement.repository';
import { PrismaService } from './prisma.service';

interface SettlementRow {
  id: string;
  shiftId: string;
  driverId: string;
  depotId: string;
  status: string;
  orderIds: string[];
  expectedAmount: number;
  depositedAmount: number;
  variance: number;
  chargedToDriver: boolean;
  note: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SettlementPrismaRepository implements SettlementRepository {
  private static readonly HISTORY_LIMIT = 60;

  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: SettlementRow): SettlementRecord {
    return { ...row, status: row.status as SettlementStatus };
  }

  async create(data: CreateSettlementData): Promise<SettlementRecord> {
    const row = await this.prisma.cashSettlement.create({ data });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<SettlementRecord | null> {
    const row = await this.prisma.cashSettlement.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByShift(shiftId: string): Promise<SettlementRecord | null> {
    const row = await this.prisma.cashSettlement.findUnique({ where: { shiftId } });
    return row ? this.toRecord(row) : null;
  }

  async listByDriver(driverId: string, limit: number): Promise<SettlementRecord[]> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, SettlementPrismaRepository.HISTORY_LIMIT),
    });
    return rows.map((r) => this.toRecord(r));
  }

  async search(query: SettlementQuery): Promise<SettlementRecord[]> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: {
        depotId: query.depotId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: SettlementPrismaRepository.HISTORY_LIMIT,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async chargedShortfallByDriver(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<CourierShortfall[]> {
    const rows = await this.prisma.cashSettlement.groupBy({
      by: ['driverId'],
      where: { depotId, chargedToDriver: true, createdAt: { gte: from, lt: to } },
      _sum: { variance: true },
    });
    // variance is negative for a shortfall; report the positive amount owed.
    return rows.map((r) => ({ driverId: r.driverId, shortfallIdr: Math.abs(r._sum.variance ?? 0) }));
  }

  async verifiedByOperatorInWindow(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<OperatorSettlementStats[]> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: {
        depotId,
        status: SettlementStatus.VERIFIED,
        verifiedBy: { not: null },
        verifiedAt: { gte: from, lt: to },
      },
      select: { verifiedBy: true, variance: true },
    });
    const grouped = new Map<string, OperatorSettlementStats>();
    for (const row of rows) {
      if (!row.verifiedBy) continue;
      const stats = grouped.get(row.verifiedBy) ?? {
        operatorId: row.verifiedBy,
        verifiedSettlements: 0,
        varianceIdr: 0,
      };
      stats.verifiedSettlements += 1;
      stats.varianceIdr += Math.abs(row.variance);
      grouped.set(row.verifiedBy, stats);
    }
    return [...grouped.values()];
  }

  async resolve(id: string, patch: ResolveSettlementPatch): Promise<SettlementRecord> {
    const row = await this.prisma.cashSettlement.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }
}
