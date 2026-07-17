import { Injectable } from '@nestjs/common';

import { GallonCondition } from '../../domain/gallon-return';
import {
  CreateGallonReturnData,
  GallonReturnDepotRow,
  GallonReturnRecord,
  GallonReturnRepository,
  GallonReturnSummary,
} from '../../application/ports/gallon-return.repository';
import { PrismaService } from './prisma.service';

interface ReturnRow {
  id: string;
  depotId: string;
  customerId: string | null;
  orderId: string | null;
  quantity: number;
  condition: string;
  depositRefunded: unknown; // Prisma Decimal
  note: string | null;
  actorId: string;
  createdAt: Date;
}

@Injectable()
export class GallonReturnPrismaRepository implements GallonReturnRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ReturnRow): GallonReturnRecord {
    return {
      ...row,
      condition: row.condition as GallonCondition,
      depositRefunded: Number(row.depositRefunded),
    };
  }

  async create(data: CreateGallonReturnData): Promise<GallonReturnRecord> {
    const row = await this.prisma.gallonReturn.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(
    depotId: string,
    page: number,
    limit: number,
  ): Promise<{ items: GallonReturnRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.gallonReturn.findMany({
        where: { depotId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.gallonReturn.count({ where: { depotId } }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
  }

  async summaryForDepot(depotId: string): Promise<GallonReturnSummary> {
    const [agg, damaged] = await Promise.all([
      this.prisma.gallonReturn.aggregate({
        where: { depotId },
        _count: { _all: true },
        _sum: { quantity: true, depositRefunded: true },
      }),
      this.prisma.gallonReturn.count({ where: { depotId, condition: GallonCondition.DAMAGED } }),
    ]);
    return {
      returns: agg._count._all,
      gallons: agg._sum.quantity ?? 0,
      damaged,
      depositRefunded: Number(agg._sum.depositRefunded ?? 0),
    };
  }

  async networkSummary(): Promise<GallonReturnDepotRow[]> {
    const grouped = await this.prisma.gallonReturn.groupBy({
      by: ['depotId'],
      _sum: { quantity: true, depositRefunded: true },
    });
    return grouped.map((g) => ({
      depotId: g.depotId,
      gallons: g._sum.quantity ?? 0,
      depositRefunded: Number(g._sum.depositRefunded ?? 0),
    }));
  }
}
