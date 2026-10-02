import { Injectable } from '@nestjs/common';

import {
  HistoricalDepotSum,
  HistoricalMethodSum,
  HistoricalProductSum,
  ImportedSalesTransactionRecord,
  NewImportedSalesTransaction,
  SalesImportRepository,
  normalizeMethod,
} from '../../application/ports/sales-import.repository';
import { PrismaService } from './prisma.service';

interface Row {
  id: string;
  depotId: string;
  externalRef: string;
  occurredAt: Date;
  customerLabel: string | null;
  productLabel: string;
  quantity: number;
  unitPrice: { toNumber(): number };
  lineTotal: { toNumber(): number };
  paymentMethod: string | null;
  batchId: string;
  importedBy: string | null;
  importedAt: Date;
}

function toRecord(row: Row): ImportedSalesTransactionRecord {
  return {
    ...row,
    unitPrice: row.unitPrice.toNumber(),
    lineTotal: row.lineTotal.toNumber(),
  };
}

/** Either bound omitted means unbounded on that side — matches `ReportRange`'s own meaning. */
function occurredAtFilter(range: { from?: Date; to?: Date }): { gte?: Date; lt?: Date } {
  const filter: { gte?: Date; lt?: Date } = {};
  if (range.from) filter.gte = range.from;
  if (range.to) filter.lt = range.to;
  return filter;
}

/** Duplicate detection the service relies on: re-importing the same (depotId, externalRef). */
export function isDuplicateExternalRef(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta } = error as { code?: string; meta?: { target?: unknown } };
  if (code !== 'P2002') return false;
  const target = meta?.target;
  return Array.isArray(target)
    ? target.includes('externalRef')
    : String(target ?? '').includes('externalRef');
}

@Injectable()
export class SalesImportPrismaRepository implements SalesImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(row: NewImportedSalesTransaction): Promise<ImportedSalesTransactionRecord> {
    const created = await this.prisma.importedSalesTransaction.create({ data: row });
    return toRecord(created);
  }

  async listByDepot(
    depotId: string,
    range: { from: Date; to: Date },
  ): Promise<ImportedSalesTransactionRecord[]> {
    const rows = await this.prisma.importedSalesTransaction.findMany({
      where: { depotId, occurredAt: { gte: range.from, lt: range.to } },
      orderBy: { occurredAt: 'desc' },
    });
    return rows.map(toRecord);
  }

  async sumByDepot(range: { from?: Date; to?: Date }): Promise<HistoricalDepotSum[]> {
    const rows = await this.prisma.importedSalesTransaction.groupBy({
      by: ['depotId'],
      where: { occurredAt: occurredAtFilter(range) },
      _count: { _all: true },
      _sum: { lineTotal: true },
    });
    return rows.map((r) => ({
      depotId: r.depotId,
      orders: r._count._all,
      revenue: r._sum.lineTotal?.toNumber() ?? 0,
    }));
  }

  async sumByProduct(range: { from?: Date; to?: Date }): Promise<HistoricalProductSum[]> {
    const rows = await this.prisma.importedSalesTransaction.groupBy({
      by: ['productLabel'],
      where: { occurredAt: occurredAtFilter(range) },
      _count: { _all: true },
      _sum: { lineTotal: true },
    });
    return rows.map((r) => ({
      productLabel: r.productLabel,
      orders: r._count._all,
      revenue: r._sum.lineTotal?.toNumber() ?? 0,
    }));
  }

  /**
   * Grouped by the RAW text first (SQL can't run `normalizeMethod`'s regex), then folded
   * onto the five known methods or 'OTHER' in JS — so "Tunai" and "tunai" from two
   * different old systems land in the same CASH bucket instead of two rows.
   */
  async sumByMethod(range: { from?: Date; to?: Date }): Promise<HistoricalMethodSum[]> {
    const rows = await this.prisma.importedSalesTransaction.groupBy({
      by: ['paymentMethod'],
      where: { occurredAt: occurredAtFilter(range) },
      _count: { _all: true },
      _sum: { lineTotal: true },
    });
    const byMethod = new Map<string, HistoricalMethodSum>();
    for (const r of rows) {
      const method = normalizeMethod(r.paymentMethod);
      const orders = r._count._all;
      const revenue = r._sum.lineTotal?.toNumber() ?? 0;
      const existing = byMethod.get(method);
      if (existing) {
        existing.orders += orders;
        existing.revenue += revenue;
      } else {
        byMethod.set(method, { method, orders, revenue });
      }
    }
    return [...byMethod.values()];
  }
}
