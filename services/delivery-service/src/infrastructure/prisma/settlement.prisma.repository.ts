import { Injectable } from '@nestjs/common';

import { SettlementStatus } from '../../domain/settlement';
import {
  CreateSettlementData,
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

  async resolve(id: string, patch: ResolveSettlementPatch): Promise<SettlementRecord> {
    const row = await this.prisma.cashSettlement.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }
}
