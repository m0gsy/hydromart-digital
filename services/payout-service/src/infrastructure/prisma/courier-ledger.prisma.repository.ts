import { Injectable } from '@nestjs/common';

import { CourierEarningRule, CourierLedgerEntryType } from '../../domain/courier-earning';
import {
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateCourierLedgerData,
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

interface RuleRow {
  baseFare: unknown;
  peakBonus: unknown;
  onTimeBonus: unknown;
  peakStartHour: number;
  peakEndHour: number;
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

  async create(data: CreateCourierLedgerData): Promise<CourierLedgerEntryRecord> {
    const row = await this.prisma.courierLedgerEntry.create({ data });
    return this.toEntry(row as unknown as LedgerRow);
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

  async sumByType(
    courierId: string,
    type: CourierLedgerEntryType,
    since: Date,
  ): Promise<number> {
    const agg = await this.prisma.courierLedgerEntry.aggregate({
      where: { courierId, type, occurredAt: { gte: since } },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0);
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

  async currentRule(depotId: string | null): Promise<CourierEarningRule | null> {
    // Prefer the depot's own newest rule; fall back to the network default (NULL).
    const specific = depotId
      ? await this.prisma.courierEarningRule.findFirst({
          where: { depotId },
          orderBy: { effectiveDate: 'desc' },
        })
      : null;
    const row =
      specific ??
      (await this.prisma.courierEarningRule.findFirst({
        where: { depotId: null },
        orderBy: { effectiveDate: 'desc' },
      }));
    if (!row) return null;
    const r = row as unknown as RuleRow;
    return {
      baseFare: Number(r.baseFare),
      peakBonus: Number(r.peakBonus),
      onTimeBonus: Number(r.onTimeBonus),
      peakStartHour: r.peakStartHour,
      peakEndHour: r.peakEndHour,
    };
  }
}
