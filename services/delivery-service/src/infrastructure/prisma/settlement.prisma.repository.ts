import { Injectable } from '@nestjs/common';

import { SettlementStatus } from '../../domain/settlement';
import {
  SettlementAlreadyExistsError,
  SettlementChargePendingError,
  SettlementNoChargePendingError,
  SettlementNotSubmittedError,
} from '../../domain/errors';
import {
  CourierShortfall,
  CreateSettlementData,
  DepositedCod,
  OperatorSettlementStats,
  ResolveSettlementPatch,
  SettlementQuery,
  SettlementRecord,
  SettlementRepository,
} from '../../application/ports/settlement.repository';
import { PrismaService } from './prisma.service';

interface SettlementRow {
  id: string;
  shiftId: string;
  driverId: string;
  depotId: string;
  status: string;
  orderIds: string[];
  expectedAmount: number;
  depositedAmount: number;
  variance: number;
  chargedToDriver: boolean;
  note: string | null;
  chargeRequestedBy: string | null;
  chargeRequestedAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const RESOLVABLE = [SettlementStatus.SUBMITTED, SettlementStatus.DISPUTED];

@Injectable()
export class SettlementPrismaRepository implements SettlementRepository {
  private static readonly HISTORY_LIMIT = 60;

  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: SettlementRow): SettlementRecord {
    return { ...row, status: row.status as SettlementStatus };
  }

  async create(data: CreateSettlementData): Promise<SettlementRecord> {
    try {
      const row = await this.prisma.cashSettlement.create({ data });
      return this.toRecord(row);
    } catch (error) {
      // shiftId is unique: two submits for one shift, past the service's read-then-write check.
      if ((error as { code?: string } | null)?.code === 'P2002') {
        throw new SettlementAlreadyExistsError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<SettlementRecord | null> {
    const row = await this.prisma.cashSettlement.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findByShift(shiftId: string): Promise<SettlementRecord | null> {
    const row = await this.prisma.cashSettlement.findUnique({ where: { shiftId } });
    return row ? this.toRecord(row) : null;
  }

  async listByDriver(driverId: string, limit: number): Promise<SettlementRecord[]> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, SettlementPrismaRepository.HISTORY_LIMIT),
    });
    return rows.map((r) => this.toRecord(r));
  }

  async search(query: SettlementQuery): Promise<SettlementRecord[]> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: {
        depotId: query.depotId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: SettlementPrismaRepository.HISTORY_LIMIT,
    });
    return rows.map((r) => this.toRecord(r));
  }

  /**
   * CA-2-63: keyed on `verifiedAt`, like the deposit it belongs to.
   *
   * It was keyed on `createdAt` — the moment the COURIER submitted — while
   * `depositedInWindow` two functions below has always keyed the same settlement on
   * `verifiedAt`, with the reason written there: a deposit belongs to the day the cashier
   * ACCEPTED the cash. So the two halves of one settlement landed in different periods. A
   * shortfall submitted on 31 August and verified on 1 September was deducted from
   * AUGUST's commission while its deposit counted as September — and August's pay run may
   * already have closed, which means a deduction against a period nobody can still pay.
   *
   * `chargedToDriver` is decided AT verification, too: until a cashier accepts the cash and
   * charges it, there is no charge to report. Keying on the moment before that decision was
   * asking when the courier handed over a bag, not when the depot took the loss.
   *
   * A settlement not yet verified has a null `verifiedAt`, so it simply falls outside every
   * window until somebody accepts it — which is the honest answer, not a zero.
   */
  async chargedShortfallByDriver(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<CourierShortfall[]> {
    const rows = await this.prisma.cashSettlement.groupBy({
      by: ['driverId'],
      where: { depotId, chargedToDriver: true, verifiedAt: { gte: from, lt: to } },
      _sum: { variance: true },
    });
    // variance is negative for a shortfall; report the positive amount owed.
    return rows.map((r) => ({
      driverId: r.driverId,
      shortfallIdr: Math.abs(r._sum.variance ?? 0),
    }));
  }

  /**
   * Keyed on `verifiedAt`, not `createdAt`: a deposit belongs to the day the cashier
   * ACCEPTED the cash, which is the day the depot can close its books on. A settlement
   * submitted late last night and verified this morning is this morning's money.
   */
  async depositedInWindow(depotId: string, from: Date, to: Date): Promise<DepositedCod> {
    const rows = await this.prisma.cashSettlement.aggregate({
      where: {
        depotId,
        status: SettlementStatus.VERIFIED,
        verifiedAt: { gte: from, lt: to },
      },
      _sum: { depositedAmount: true, expectedAmount: true },
      _count: { _all: true },
    });
    return {
      depositedIdr: rows._sum.depositedAmount ?? 0,
      expectedIdr: rows._sum.expectedAmount ?? 0,
      settlements: rows._count._all,
    };
  }

  async verifiedByOperatorInWindow(
    depotId: string,
    from: Date,
    to: Date,
  ): Promise<OperatorSettlementStats[]> {
    const rows = await this.prisma.cashSettlement.findMany({
      where: {
        depotId,
        status: SettlementStatus.VERIFIED,
        verifiedBy: { not: null },
        verifiedAt: { gte: from, lt: to },
      },
      select: { verifiedBy: true, variance: true },
    });
    const grouped = new Map<string, OperatorSettlementStats>();
    for (const row of rows) {
      if (!row.verifiedBy) continue;
      const stats = grouped.get(row.verifiedBy) ?? {
        operatorId: row.verifiedBy,
        verifiedSettlements: 0,
        varianceIdr: 0,
      };
      stats.verifiedSettlements += 1;
      stats.varianceIdr += Math.abs(row.variance);
      grouped.set(row.verifiedBy, stats);
    }
    return [...grouped.values()];
  }

  /** Only a settlement that can still be ruled on may be moved: the second ruling loses. */
  async resolve(id: string, patch: ResolveSettlementPatch): Promise<SettlementRecord> {
    const { count } = await this.prisma.cashSettlement.updateMany({
      where: { id, status: { in: RESOLVABLE } },
      data: patch,
    });
    if (count === 0) throw new SettlementNotSubmittedError();
    return this.toRecord(await this.prisma.cashSettlement.findUniqueOrThrow({ where: { id } }));
  }

  async claimChargeApproval(id: string, by: string): Promise<boolean> {
    const { count } = await this.prisma.cashSettlement.updateMany({
      where: {
        id,
        status: { in: RESOLVABLE },
        chargeRequestedBy: { not: null },
        chargeApprovedBy: null,
      },
      data: { chargeApprovedBy: by },
    });
    return count === 1;
  }

  async releaseChargeApproval(id: string, by: string): Promise<void> {
    await this.prisma.cashSettlement.updateMany({
      where: { id, chargeApprovedBy: by },
      data: { chargeApprovedBy: null },
    });
  }

  async requestCharge(id: string, by: string, note: string | null): Promise<SettlementRecord> {
    // Two cashiers raising a charge on one settlement: the first stands, the second is told.
    const { count } = await this.prisma.cashSettlement.updateMany({
      where: { id, status: { in: RESOLVABLE }, chargeRequestedBy: null },
      data: {
        chargeRequestedBy: by,
        chargeRequestedAt: new Date(),
        ...(note ? { note } : {}),
      },
    });
    if (count === 0) throw new SettlementChargePendingError();
    return this.toRecord(await this.prisma.cashSettlement.findUniqueOrThrow({ where: { id } }));
  }

  async clearChargeRequest(id: string, note: string | null): Promise<SettlementRecord> {
    // Not while an approver holds the claim: their debit may already be on its way to payout.
    const { count } = await this.prisma.cashSettlement.updateMany({
      where: {
        id,
        status: { in: RESOLVABLE },
        chargeRequestedBy: { not: null },
        chargeApprovedBy: null,
      },
      data: { chargeRequestedBy: null, chargeRequestedAt: null, note },
    });
    if (count === 0) throw new SettlementNoChargePendingError();
    return this.toRecord(await this.prisma.cashSettlement.findUniqueOrThrow({ where: { id } }));
  }
}
