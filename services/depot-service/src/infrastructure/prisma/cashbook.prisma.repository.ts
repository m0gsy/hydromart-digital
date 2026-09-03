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
  /** CA-2-22: the entry this one cancels; null on an ordinary posting. */
  reversesId: string | null;
  reversalReason: string | null;
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

  async findById(id: string): Promise<CashbookEntry | null> {
    const row = await this.prisma.cashbookEntry.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * CA-2-22: the reversal of `id`, when one exists.
   *
   * `reversesId` carries a partial unique index, so this is a point read rather than a
   * scan — and the index is the real defence: two operators pressing "koreksi" together
   * would otherwise both pass the check here and both post.
   */
  async findReversalOf(id: string): Promise<CashbookEntry | null> {
    const row = await this.prisma.cashbookEntry.findFirst({ where: { reversesId: id } });
    return row ? this.toRecord(row) : null;
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
