import { Injectable } from '@nestjs/common';

import { CommissionSchemeRecord } from '../../domain/commission';
import {
  CommissionSchemeRepository,
  CreateCommissionSchemeData,
} from '../../application/ports/commission-scheme.repository';
import { PrismaService } from './prisma.service';

interface SchemeRow {
  id: string;
  depotId: string;
  ownerName: string | null;
  pct: unknown; // Prisma Decimal
  effectiveDate: Date;
  createdAt: Date;
}

@Injectable()
export class CommissionSchemePrismaRepository implements CommissionSchemeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: SchemeRow): CommissionSchemeRecord {
    return { ...row, pct: Number(row.pct) };
  }

  async listCurrent(): Promise<CommissionSchemeRecord[]> {
    // DISTINCT ON (depotId) taking the newest effectiveDate = each depot's current pct.
    const rows = await this.prisma.commissionScheme.findMany({
      orderBy: [{ depotId: 'asc' }, { effectiveDate: 'desc' }],
      distinct: ['depotId'],
    });
    return rows.map((r) => this.toRecord(r as unknown as SchemeRow));
  }

  async createMany(rows: CreateCommissionSchemeData[]): Promise<CommissionSchemeRecord[]> {
    // One create per row inside a transaction so we can return the persisted records.
    const created = await this.prisma.$transaction(
      rows.map((r) => this.prisma.commissionScheme.create({ data: r })),
    );
    return created.map((r) => this.toRecord(r as unknown as SchemeRow));
  }
}
