import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../prisma/generated/client';

import {
  DepotFixedCostRepository,
  UpsertDepotFixedCostData,
} from '../../application/ports/depot-fixed-cost.repository';
import { DepotFixedCost } from '../../domain/depot-fixed-cost';
import { PrismaService } from './prisma.service';

const WITH_DEPOT = { depot: { select: { code: true, name: true } } } satisfies Prisma.DepotFixedCostInclude;
type Row = Prisma.DepotFixedCostGetPayload<{ include: typeof WITH_DEPOT }>;

const toRecord = (row: Row): DepotFixedCost => ({
  id: row.id,
  depotId: row.depotId,
  depotCode: row.depot.code,
  depotName: row.depot.name,
  month: row.month,
  category: row.category,
  amountIdr: row.amountIdr,
  note: row.note,
  updatedAt: row.updatedAt,
});

@Injectable()
export class DepotFixedCostPrismaRepository implements DepotFixedCostRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(depotId: string, month: string, category: string): Promise<DepotFixedCost | null> {
    const row = await this.prisma.depotFixedCost.findUnique({
      where: { depotId_month_category: { depotId, month, category } },
      include: WITH_DEPOT,
    });
    return row ? toRecord(row) : null;
  }

  async listForMonth(month: string, depotId?: string): Promise<DepotFixedCost[]> {
    const rows = await this.prisma.depotFixedCost.findMany({
      where: { month, ...(depotId ? { depotId } : {}) },
      include: WITH_DEPOT,
      orderBy: [{ depot: { code: 'asc' } }, { category: 'asc' }],
    });
    return rows.map(toRecord);
  }

  async totalsForDepots(month: string, depotIds: string[]): Promise<{ depotId: string; totalIdr: number }[]> {
    const sums = await this.prisma.depotFixedCost.groupBy({
      by: ['depotId'],
      where: { month, depotId: { in: depotIds } },
      _sum: { amountIdr: true },
    });
    return sums.map((s) => ({ depotId: s.depotId, totalIdr: s._sum.amountIdr ?? 0 }));
  }

  async upsert(data: UpsertDepotFixedCostData): Promise<void> {
    const { depotId, month, category, ...values } = data;
    await this.prisma.depotFixedCost.upsert({
      where: { depotId_month_category: { depotId, month, category } },
      create: data,
      update: values,
    });
  }
}
