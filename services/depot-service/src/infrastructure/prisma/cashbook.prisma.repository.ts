import { Injectable } from '@nestjs/common';

import { CashbookEntry, CashDirection } from '../../domain/cashbook';
import {
  CashbookDateRange,
  CashbookRepository,
  CreateCashbookEntryData,
} from '../../application/ports/cashbook.repository';
import { PrismaService } from './prisma.service';

interface CashbookRow {
  id: string;
  depotId: string;
  direction: string;
  category: string;
  label: string;
  amountIdr: number;
  occurredAt: Date;
  sourceRef: string | null;
  actorId: string;
  createdAt: Date;
}

@Injectable()
export class CashbookPrismaRepository implements CashbookRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: CashbookRow): CashbookEntry {
    return { ...row, direction: row.direction as CashDirection };
  }

  async create(data: CreateCashbookEntryData): Promise<CashbookEntry> {
    const row = await this.prisma.cashbookEntry.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string, range: CashbookDateRange): Promise<CashbookEntry[]> {
    const occurredAt =
      range.from || range.to
        ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) }
        : undefined;
    const rows = await this.prisma.cashbookEntry.findMany({
      where: { depotId, ...(occurredAt ? { occurredAt } : {}) },
      orderBy: { occurredAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }
}
