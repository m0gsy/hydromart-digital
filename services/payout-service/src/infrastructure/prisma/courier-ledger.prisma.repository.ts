import { Injectable } from '@nestjs/common';

import { CourierLedgerEntryType } from '../../domain/courier-earning';
import {
  CourierEarningRuleRecord,
  CourierEarningsRow,
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateCourierLedgerData,
  CreateEarningRuleData,
} from '../../application/ports/courier-ledger.repository';
import { PrismaService } from './prisma.service';

interface LedgerRow {
  id: string;
  courierId: string;
  depotId: string | null;
  type: string;
  amount: unknown; // Prisma Decimal
  description: string;
  sourceRef: string | null;
  occurredAt: Date;
  createdAt: Date;
}

interface FullRuleRow {
  baseFare: unknown;
  peakBonus: unknown;
  onTimeBonus: unknown;
  peakStartHour: number;
  peakEndHour: number;
  monthlyTarget: unknown;
  tiers: { deliveries: number; bonus: unknown }[];
  id: string;
  depotId: string | null;
  effectiveDate: Date;
  createdAt: Date;
}

@Injectable()
export class CourierLedgerPrismaRepository implements CourierLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toEntry(row: LedgerRow): CourierLedgerEntryRecord {
    return {
      id: row.id,
      courierId: row.courierId,
      depotId: row.depotId,
      type: row.type as CourierLedgerEntryType,
      amount: Number(row.amount),
      description: row.description,
      sourceRef: row.sourceRef,
      occurredAt: row.occurredAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * Prisma's unique-constraint violation. Matched on the code rather than the class so
   * this does not depend on which generated client instance threw it.
   * ponytail: local to the one repository that needs it — promote if a second caller appears.
   */
  private static isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === 'P2002';
  }

  async create(data: CreateCourierLedgerData): Promise<CourierLedgerEntryRecord> {
    try {
      const row = await this.prisma.courierLedgerEntry.create({ data });
      return this.toEntry(row as unknown as LedgerRow);
    } catch (error) {
      // B-10: the callers guard with findBySourceRef, which is check-then-insert — two
      // concurrent pushes of the same event both find nothing and both insert. The unique
      // index on sourceRef is what actually stops the double credit; without this catch it
      // stopped it by throwing a 500 at whoever lost, which reads as a broken payout rather
      // than a duplicate that was correctly refused.
      //
      // The row the winner wrote IS the intended outcome, so return it: the operation is
      // idempotent, which is what the at-least-once delivery→payout push needs.
      if (CourierLedgerPrismaRepository.isUniqueViolation(error) && data.sourceRef) {
        const existing = await this.findBySourceRef(data.sourceRef);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async findBySourceRef(sourceRef: string): Promise<CourierLedgerEntryRecord | null> {
    const row = await this.prisma.courierLedgerEntry.findUnique({ where: { sourceRef } });
    return row ? this.toEntry(row as unknown as LedgerRow) : null;
  }

  async balanceFor(courierId: string): Promise<number> {
    const agg = await this.prisma.courierLedgerEntry.aggregate({
      where: { courierId },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  async sumByType(courierId: string, type: CourierLedgerEntryType, since: Date): Promise<number> {
    const agg = await this.prisma.courierLedgerEntry.aggregate({
      where: { courierId, type, occurredAt: { gte: since } },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
  }

  async earningsByDepot(depotId: string, from: Date, to: Date): Promise<CourierEarningsRow[]> {
    // Grouped by courier AND type: the sum wants both credit types, the delivery count
    // wants only EARNING (an incentive rung is a bonus, not a delivery).
    const grouped = await this.prisma.courierLedgerEntry.groupBy({
      by: ['courierId', 'type'],
      where: {
        depotId,
        type: { in: ['EARNING', 'INCENTIVE'] },
        occurredAt: { gte: from, lte: to },
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const byCourier = new Map<string, CourierEarningsRow>();
    for (const g of grouped) {
      const row = byCourier.get(g.courierId) ?? {
        courierId: g.courierId,
        earnedIdr: 0,
        paidDeliveries: 0,
      };
      row.earnedIdr += Number(g._sum.amount ?? 0);
      if (g.type === 'EARNING') row.paidDeliveries += g._count._all;
      byCourier.set(g.courierId, row);
    }
    return [...byCourier.values()];
  }

  async countByType(
    courierId: string,
    type: CourierLedgerEntryType,
    since: Date,
    depotId?: string,
  ): Promise<number> {
    return this.prisma.courierLedgerEntry.count({
      where: { courierId, type, occurredAt: { gte: since }, ...(depotId ? { depotId } : {}) },
    });
  }

  async listForCourier(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<{ items: CourierLedgerEntryRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.courierLedgerEntry.findMany({
        where: { courierId },
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.courierLedgerEntry.count({ where: { courierId } }),
    ]);
    return { items: rows.map((r) => this.toEntry(r as unknown as LedgerRow)), total };
  }

  async currentRule(depotId: string | null): Promise<CourierEarningRuleRecord | null> {
    // Prefer the depot's own newest rule; fall back to the network default (NULL).
    const include = { tiers: { orderBy: { deliveries: 'asc' as const } } };
    const specific = depotId
      ? await this.prisma.courierEarningRule.findFirst({
          where: { depotId },
          orderBy: { effectiveDate: 'desc' },
          include,
        })
      : null;
    const row =
      specific ??
      (await this.prisma.courierEarningRule.findFirst({
        where: { depotId: null },
        orderBy: { effectiveDate: 'desc' },
        include,
      }));
    return row ? this.toRule(row as unknown as FullRuleRow) : null;
  }

  private toRule(r: FullRuleRow): CourierEarningRuleRecord {
    return {
      id: r.id,
      depotId: r.depotId,
      effectiveDate: r.effectiveDate,
      createdAt: r.createdAt,
      baseFare: Number(r.baseFare),
      peakBonus: Number(r.peakBonus),
      onTimeBonus: Number(r.onTimeBonus),
      peakStartHour: r.peakStartHour,
      peakEndHour: r.peakEndHour,
      monthlyTarget: Number(r.monthlyTarget),
      tiers: (r.tiers ?? []).map((t) => ({ deliveries: t.deliveries, bonus: Number(t.bonus) })),
    };
  }

  async listRules(): Promise<CourierEarningRuleRecord[]> {
    const rows = await this.prisma.courierEarningRule.findMany({
      orderBy: { effectiveDate: 'desc' },
      include: { tiers: { orderBy: { deliveries: 'asc' } } },
    });
    return rows.map((row) => this.toRule(row as unknown as FullRuleRow));
  }

  async createRule(data: CreateEarningRuleData): Promise<CourierEarningRuleRecord> {
    const row = await this.prisma.courierEarningRule.create({
      data: {
        depotId: data.depotId,
        baseFare: data.baseFare,
        peakBonus: data.peakBonus,
        onTimeBonus: data.onTimeBonus,
        peakStartHour: data.peakStartHour,
        peakEndHour: data.peakEndHour,
        monthlyTarget: data.monthlyTarget,
        effectiveDate: data.effectiveDate,
        tiers: { create: data.tiers.map((t) => ({ deliveries: t.deliveries, bonus: t.bonus })) },
      },
      include: { tiers: { orderBy: { deliveries: 'asc' } } },
    });
    return this.toRule(row as unknown as FullRuleRow);
  }
}
