import { Injectable } from '@nestjs/common';

import {
  CreateGallonIssueData,
  GallonIssueRecord,
  GallonIssueRepository,
  GallonIssueSummary,
} from '../../application/ports/gallon-issue.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class GallonIssuePrismaRepository implements GallonIssueRepository {
  constructor(private readonly prisma: PrismaService) {}

  // depositHeld is a plain integer column (whole IDR), so Prisma rows already match
  // GallonIssueRecord — no Decimal conversion needed (unlike gallon-return).
  async create(data: CreateGallonIssueData): Promise<GallonIssueRecord> {
    return this.prisma.gallonIssue.create({ data });
  }

  async listForDepot(
    depotId: string,
    page: number,
    limit: number,
  ): Promise<{ items: GallonIssueRecord[]; total: number }> {
    const [items, total] = await Promise.all([
      this.prisma.gallonIssue.findMany({
        where: { depotId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.gallonIssue.count({ where: { depotId } }),
    ]);
    return { items, total };
  }

  async summaryForDepot(depotId: string): Promise<GallonIssueSummary> {
    const agg = await this.prisma.gallonIssue.aggregate({
      where: { depotId },
      _count: { _all: true },
      _sum: { quantity: true, depositHeld: true },
    });
    return {
      issues: agg._count._all,
      gallons: agg._sum.quantity ?? 0,
      depositHeld: agg._sum.depositHeld ?? 0,
    };
  }
}
