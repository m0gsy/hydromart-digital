import type { GallonCustomerRow } from '../../application/ports/gallon-issue.repository';
import { Injectable } from '@nestjs/common';

import {
  GallonCustomerBalance,
  CreateGallonIssueData,
  CreateGallonIssueFromOrderData,
  GallonIssueDepotRow,
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

  /**
   * I1: `upsert` rather than create-if-absent, because two deliveries of the same
   * completion event can race and a check-then-write would let both through. `update: {}`
   * makes the second call a read: the ledger is append-only, and a booking that already
   * happened must not be restated at today's deposit rate.
   */
  async createFromOrder(data: CreateGallonIssueFromOrderData): Promise<GallonIssueRecord> {
    return this.prisma.gallonIssue.upsert({
      where: { orderId: data.orderId },
      create: data,
      update: {},
    });
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

  listForCustomerAtDepot(
    depotId: string,
    customerId: string,
    limit: number,
  ): Promise<GallonIssueRecord[]> {
    return this.prisma.gallonIssue.findMany({
      where: { depotId, customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
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

  /** I2: one customer's issued gallons and deposit held at one depot. */
  async summaryForCustomerAtDepot(
    depotId: string,
    customerId: string,
  ): Promise<GallonCustomerBalance> {
    const agg = await this.prisma.gallonIssue.aggregate({
      where: { depotId, customerId },
      _sum: { quantity: true, depositHeld: true },
    });
    return { gallons: agg._sum.quantity ?? 0, amountIdr: agg._sum.depositHeld ?? 0 };
  }

  async perCustomerForDepot(depotId: string): Promise<GallonCustomerRow[]> {
    const grouped = await this.prisma.gallonIssue.groupBy({
      by: ['customerId'],
      where: { depotId, customerId: { not: null } },
      _sum: { quantity: true, depositHeld: true },
    });
    return grouped.map((g) => ({
      customerId: g.customerId as string,
      gallons: g._sum.quantity ?? 0,
      amountIdr: g._sum.depositHeld ?? 0,
    }));
  }

  async networkSummary(): Promise<GallonIssueDepotRow[]> {
    const grouped = await this.prisma.gallonIssue.groupBy({
      by: ['depotId'],
      _sum: { quantity: true, depositHeld: true },
    });
    return grouped.map((g) => ({
      depotId: g.depotId,
      gallons: g._sum.quantity ?? 0,
      depositHeld: g._sum.depositHeld ?? 0,
    }));
  }
}
