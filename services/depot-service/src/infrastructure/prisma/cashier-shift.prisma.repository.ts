import { Injectable } from '@nestjs/common';

import { CashierShift, CashierShiftStatus } from '../../domain/cashier-shift';
import { ShiftAlreadyClosedError, ShiftAlreadyOpenError } from '../../domain/errors';
import {
  CashierShiftRepository,
  CloseShiftData,
  OpenShiftData,
} from '../../application/ports/cashier-shift.repository';
import { PrismaService } from './prisma.service';

interface ShiftRow {
  id: string;
  depotId: string;
  cashierId: string;
  cashierName: string;
  status: string;
  openingFloat: number;
  openedAt: Date;
  closedAt: Date | null;
  countedCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  note: string | null;
  liabilityIdr: number | null;
  liabilitySettledAt: Date | null;
  liabilitySettledBy: string | null;
  liabilityNote: string | null;
}

@Injectable()
export class CashierShiftPrismaRepository implements CashierShiftRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ShiftRow): CashierShift {
    return { ...row, status: row.status as CashierShiftStatus };
  }

  async open(data: OpenShiftData): Promise<CashierShift> {
    try {
      const row = await this.prisma.cashierShift.create({ data });
      return this.toRecord(row);
    } catch (error) {
      // The partial unique index is the real guard against two open shifts on one drawer;
      // the service's pre-check only makes the common case a friendlier message.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ShiftAlreadyOpenError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<CashierShift | null> {
    const row = await this.prisma.cashierShift.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findOpen(depotId: string, cashierId: string): Promise<CashierShift | null> {
    const row = await this.prisma.cashierShift.findFirst({
      where: { depotId, cashierId, status: CashierShiftStatus.OPEN },
    });
    return row ? this.toRecord(row) : null;
  }

  async listOpen(depotId: string): Promise<CashierShift[]> {
    const rows = await this.prisma.cashierShift.findMany({
      where: { depotId, status: CashierShiftStatus.OPEN },
      orderBy: { openedAt: 'asc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async listClosed(depotId: string, limit: number): Promise<CashierShift[]> {
    const rows = await this.prisma.cashierShift.findMany({
      where: { depotId, status: CashierShiftStatus.CLOSED },
      orderBy: { closedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async close(id: string, data: CloseShiftData): Promise<CashierShift> {
    // D1-01: compare-and-set on status. A bare `update({ where: { id } })` let two
    // concurrent closes both succeed, and the service posts the counter cash to the
    // cashbook after this call — so it was posted twice. Exactly one writer sees count 1.
    const { count } = await this.prisma.cashierShift.updateMany({
      where: { id, status: CashierShiftStatus.OPEN },
      data: { ...data, status: CashierShiftStatus.CLOSED },
    });
    if (count === 0) throw new ShiftAlreadyClosedError();
    const row = await this.prisma.cashierShift.findUniqueOrThrow({ where: { id } });
    return this.toRecord(row);
  }

  async recordLiability(id: string, amountIdr: number): Promise<boolean> {
    const { count } = await this.prisma.cashierShift.updateMany({
      where: { id, liabilityIdr: null },
      data: { liabilityIdr: amountIdr },
    });
    return count === 1;
  }

  async settleLiability(id: string, by: string, note: string): Promise<boolean> {
    const { count } = await this.prisma.cashierShift.updateMany({
      where: { id, liabilityIdr: { not: null }, liabilitySettledAt: null },
      data: { liabilitySettledAt: new Date(), liabilitySettledBy: by, liabilityNote: note },
    });
    return count === 1;
  }

  async listOutstandingLiabilities(depotId: string): Promise<CashierShift[]> {
    const rows = await this.prisma.cashierShift.findMany({
      where: {
        depotId,
        status: CashierShiftStatus.CLOSED,
        liabilityIdr: { not: null },
        liabilitySettledAt: null,
      },
      orderBy: { closedAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async outstandingLiability(
    depotId: string,
    cashierId: string,
    exceptShiftId?: string,
  ): Promise<number> {
    const sum = await this.prisma.cashierShift.aggregate({
      where: {
        depotId,
        cashierId,
        status: CashierShiftStatus.CLOSED,
        liabilityIdr: { not: null },
        liabilitySettledAt: null,
        ...(exceptShiftId ? { id: { not: exceptShiftId } } : {}),
      },
      _sum: { liabilityIdr: true },
    });
    return sum._sum.liabilityIdr ?? 0;
  }
}
