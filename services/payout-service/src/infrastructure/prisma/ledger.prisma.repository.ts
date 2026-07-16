import { Injectable } from '@nestjs/common';

import { LedgerEntryRecord, LedgerEntryType } from '../../domain/ledger';
import {
  CreateLedgerEntryData,
  LedgerRepository,
  OwnerBalance,
} from '../../application/ports/ledger.repository';
import { PrismaService } from './prisma.service';

interface LedgerRow {
  id: string;
  franchiseOwnerId: string;
  depotId: string | null;
  type: string;
  amount: unknown; // Prisma Decimal
  description: string;
  occurredAt: Date;
  createdAt: Date;
}

@Injectable()
export class LedgerPrismaRepository implements LedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toEntry(row: LedgerRow): LedgerEntryRecord {
    return {
      id: row.id,
      franchiseOwnerId: row.franchiseOwnerId,
      depotId: row.depotId,
      type: row.type as LedgerEntryType,
      amount: Number(row.amount),
      description: row.description,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    };
  }

  async create(data: CreateLedgerEntryData): Promise<LedgerEntryRecord> {
    const row = await this.prisma.ledgerEntry.create({ data });
    return this.toEntry(row as unknown as LedgerRow);
  }

  async balanceFor(franchiseOwnerId: string): Promise<number> {
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { franchiseOwnerId },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  async ownersWithBalance(): Promise<OwnerBalance[]> {
    const grouped = await this.prisma.ledgerEntry.groupBy({
      by: ['franchiseOwnerId'],
      _sum: { amount: true },
    });
    return grouped
      .map((g) => ({ franchiseOwnerId: g.franchiseOwnerId, availableBalance: Number(g._sum.amount ?? 0) }))
      .filter((o) => o.availableBalance > 0)
      .sort((a, b) => b.availableBalance - a.availableBalance);
  }

  async sumByType(franchiseOwnerId: string, type: LedgerEntryType, since: Date): Promise<number> {
    const agg = await this.prisma.ledgerEntry.aggregate({
      where: { franchiseOwnerId, type, occurredAt: { gte: since } },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  async listForOwner(
    franchiseOwnerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: LedgerEntryRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where: { franchiseOwnerId },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.ledgerEntry.count({ where: { franchiseOwnerId } }),
    ]);
    return { items: rows.map((r) => this.toEntry(r as unknown as LedgerRow)), total };
  }
}
