import { Injectable } from '@nestjs/common';

import { FraudEntityType, FraudLevel, FraudStatus } from '../../domain/fraud';
import {
  CreateFraudFlagData,
  FraudFlagRecord,
  FraudFlagRepository,
  ListFraudFlagsFilter,
} from '../../application/ports/fraud-flag.repository';
import { PrismaService } from './prisma.service';

interface FraudFlagRow {
  id: string;
  entityType: string;
  entityRef: string;
  score: number;
  level: string;
  signals: string[];
  status: string;
  createdAt: Date;
}

@Injectable()
export class FraudFlagPrismaRepository implements FraudFlagRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: FraudFlagRow): FraudFlagRecord {
    return {
      ...row,
      entityType: row.entityType as FraudEntityType,
      level: row.level as FraudLevel,
      status: row.status as FraudStatus,
    };
  }

  async list(filter: ListFraudFlagsFilter): Promise<FraudFlagRecord[]> {
    const where = {
      ...(filter.level ? { level: filter.level } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const rows = await this.prisma.fraudFlag.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: CreateFraudFlagData): Promise<FraudFlagRecord> {
    const row = await this.prisma.fraudFlag.create({ data });
    return this.toRecord(row);
  }

  async setStatus(id: string, status: FraudStatus): Promise<FraudFlagRecord | null> {
    const existing = await this.prisma.fraudFlag.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.prisma.fraudFlag.update({ where: { id }, data: { status } });
    return this.toRecord(row);
  }
}
