import type { GallonCustomerRow } from '../../application/ports/gallon-issue.repository';
import { Injectable } from '@nestjs/common';

import {
  GallonCustomerBalance,
  GallonDepotBalance,
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

  /**
   * I4: `depositHeld` is Decimal now, matching the return side. Prisma hands a Decimal
   * object back, and `GallonIssueRecord` promises a number — the same shape
   * `GallonReturnPrismaRepository.toRecord` has always had. Skipping this would put a
   * Decimal into arithmetic that expects a number and produce string concatenation.
   */
  private toRecord(row: { depositHeld: unknown }): GallonIssueRecord {
    return { ...(row as GallonIssueRecord), depositHeld: Number(row.depositHeld) };
  }

  async create(data: CreateGallonIssueData): Promise<GallonIssueRecord> {
    return this.toRecord(await this.prisma.gallonIssue.create({ data }));
  }

  /**
   * I1: `upsert` rather than create-if-absent, because two deliveries of the same
   * completion event can race and a check-then-write would let both through. `update: {}`
   * makes the second call a read: the ledger is append-only, and a booking that already
   * happened must not be restated at today's deposit rate.
   */
  async createFromOrder(data: CreateGallonIssueFromOrderData): Promise<GallonIssueRecord> {
    return this.toRecord(
      await this.prisma.gallonIssue.upsert({
        where: { orderId: data.orderId },
        create: data,
        update: {},
      }),
    );
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
    return { items: items.map((r) => this.toRecord(r)), total };
  }

  async listForCustomerAtDepot(
    depotId: string,
    customerId: string,
    limit: number,
  ): Promise<GallonIssueRecord[]> {
    const rows = await this.prisma.gallonIssue.findMany({
      where: { depotId, customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
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
      depositHeld: Number(agg._sum.depositHeld ?? 0),
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
    return { gallons: agg._sum.quantity ?? 0, amountIdr: Number(agg._sum.depositHeld ?? 0) };
  }

  /** I5: one customer's issued gallons and deposit held, grouped by depot. */
  async perDepotForCustomer(customerId: string): Promise<GallonDepotBalance[]> {
    const grouped = await this.prisma.gallonIssue.groupBy({
      by: ['depotId'],
      where: { customerId },
      _sum: { quantity: true, depositHeld: true },
    });
    return grouped.map((g) => ({
      depotId: g.depotId,
      gallons: g._sum.quantity ?? 0,
      // I4: I5 opened this read while the column was still Int, so it never needed a cast.
      // It does now — and an uncast Decimal does not throw here, it reaches the customer's
      // own deposit screen and concatenates instead of adding.
      amountIdr: Number(g._sum.depositHeld ?? 0),
    }));
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
      amountIdr: Number(g._sum.depositHeld ?? 0),
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
      depositHeld: Number(g._sum.depositHeld ?? 0),
    }));
  }
}
