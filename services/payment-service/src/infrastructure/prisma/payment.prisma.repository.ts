import { Injectable } from '@nestjs/common';
import { nextCursor, pageArgs } from '@hydromart/platform';

import { PaymentMethod, PaymentStatus, RefundApproval } from '../../domain/payment';
import {
  CashCollectedSummary,
  OrderCashRow,
  CreatePaymentData,
  DateRange,
  PaymentQuery,
  PaymentRecord,
  PaymentRepository,
  PaymentStatusPatch,
  UnsettledMethodAggregate,
} from '../../application/ports/payment.repository';
import { PaymentAlreadyExistsError } from '../../domain/errors';
import { PrismaService } from './prisma.service';

type Decimalish = { toNumber(): number };

/** Prisma unique-constraint violation (P2002), detected without importing the client namespace. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

interface PaymentRow {
  id: string;
  orderId: string;
  customerId: string;
  method: string;
  status: string;
  amount: Decimalish;
  reference: string | null;
  instruction: string | null;
  gatewayData: string | null;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  refundReason: string | null;
  refundedAmount: Decimalish | null;
  refundApproval: string;
  cashReceived: Decimalish | null;
  changeGiven: Decimalish | null;
  depotId: string | null;
  cashierShiftId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ACTIVE_STATUSES: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.PAID];

@Injectable()
export class PaymentPrismaRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: PaymentRow): PaymentRecord {
    return {
      id: row.id,
      orderId: row.orderId,
      customerId: row.customerId,
      method: row.method as PaymentMethod,
      status: row.status as PaymentStatus,
      amount: row.amount.toNumber(),
      reference: row.reference,
      instruction: row.instruction,
      gatewayData: row.gatewayData,
      paidAt: row.paidAt,
      failedAt: row.failedAt,
      refundedAt: row.refundedAt,
      refundReason: row.refundReason,
      refundedAmount: row.refundedAmount ? row.refundedAmount.toNumber() : null,
      refundApproval: row.refundApproval as RefundApproval,
      cashReceived: row.cashReceived ? row.cashReceived.toNumber() : null,
      changeGiven: row.changeGiven ? row.changeGiven.toNumber() : null,
      depotId: row.depotId,
      cashierShiftId: row.cashierShiftId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreatePaymentData): Promise<PaymentRecord> {
    try {
      const row = await this.prisma.payment.create({ data });
      return this.toRecord(row);
    } catch (error) {
      // Audit DB-1: the partial unique index (one active PENDING/PAID payment per
      // order) is the real guard against the initiate() check-then-act race; the
      // loser of a concurrent double-initiate hits P2002 here — translate it to the
      // same conflict the pre-check raises so a race can never double-create.
      if (isUniqueViolation(error)) {
        throw new PaymentAlreadyExistsError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findActiveByOrder(orderId: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ACTIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toRecord(row) : null;
  }

  async findStalePending(
    before: Date,
    methods: readonly PaymentMethod[],
    limit: number,
  ): Promise<PaymentRecord[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.PENDING,
        method: { in: methods as PaymentMethod[] },
        createdAt: { lt: before },
      },
      // Oldest first: the sweep is bounded, so the rows that have been stuck longest are
      // the ones a bounded pass must reach.
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async findByReference(reference: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findFirst({ where: { reference } });
    return row ? this.toRecord(row) : null;
  }

  async search(
    query: PaymentQuery,
  ): Promise<{ items: PaymentRecord[]; total: number; nextCursor: string | null }> {
    const where = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        // `id` last so the cursor cannot straddle two payments in the same millisecond.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
      nextCursor: nextCursor(rows, query.limit),
    };
  }

  async findByOrderIds(orderIds: string[]): Promise<PaymentRecord[]> {
    if (orderIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      // Newest first per order: a new attempt only exists because the previous one failed
      // or was cancelled, so the first row an order hits is its current truth.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => this.toRecord(r));
  }

  async refundCountsByCustomer(
    from: Date,
    to: Date,
    minRefunds: number,
  ): Promise<{ customerId: string; refunds: number; amountIdr: number }[]> {
    // `refundedAt`, not `createdAt`: the window is about when money went back, not when the
    // payment was taken. A refund settled today on a payment from March belongs to today.
    const grouped = await this.prisma.payment.groupBy({
      by: ['customerId'],
      where: { status: PaymentStatus.REFUNDED, refundedAt: { gte: from, lte: to } },
      _sum: { refundedAmount: true },
      _count: { _all: true },
    });
    return grouped
      .filter((g) => g._count._all >= minRefunds)
      .map((g) => ({
        customerId: g.customerId,
        refunds: g._count._all,
        amountIdr: g._sum.refundedAmount ? Math.round(Number(g._sum.refundedAmount)) : 0,
      }))
      .sort((a, b) => b.refunds - a.refunds);
  }

  async listPendingRefunds(query: {
    page: number;
    limit: number;
  }): Promise<{ items: PaymentRecord[]; total: number }> {
    const where = { refundApproval: RefundApproval.PENDING };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
  }

  async aggregateUnsettledByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    const createdAt =
      range.from || range.to
        ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) }
        : undefined;
    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { status: PaymentStatus.PENDING, ...(createdAt ? { createdAt } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return grouped.map((g) => ({
      method: g.method as PaymentMethod,
      amount: g._sum.amount ? Number(g._sum.amount) : 0,
      count: g._count._all,
    }));
  }

  async aggregateRevenueByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    const createdAt =
      range.from || range.to
        ? { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) }
        : undefined;
    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      where: { status: PaymentStatus.PAID, ...(createdAt ? { createdAt } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return grouped.map((g) => ({
      method: g.method as PaymentMethod,
      amount: g._sum.amount ? Number(g._sum.amount) : 0,
      count: g._count._all,
    }));
  }

  async cashByOrder(orderIds: string[]): Promise<OrderCashRow[]> {
    if (orderIds.length === 0) {
      return [];
    }
    // groupBy, not findMany: an order can legitimately carry more than one PAID cash row
    // (a partial settlement, a re-take after a void), and every caller wants one number
    // per order rather than a row per payment.
    const rows = await this.prisma.payment.groupBy({
      by: ['orderId'],
      where: {
        orderId: { in: orderIds },
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
      },
      _sum: { amount: true },
    });
    return rows.map((r) => ({
      orderId: r.orderId,
      amountIdr: r._sum.amount ? Math.round(Number(r._sum.amount)) : 0,
    }));
  }

  /**
   * C2: a shift asks for ITS OWN drawer.
   *
   * This was a depot plus a time window and nothing else, while concurrent shifts at one
   * depot are supported — so two cashiers open at once each claimed the whole window. The
   * same rupiah counted against both tills, one of them short by the other's takings, and
   * the counter cash posted to the cash book twice.
   *
   * The `cashierShiftId: null` arm is the GRANDFATHER, and it is not a loose end: every
   * counter payment taken before this column existed has no shift id, and dropping those
   * would turn a day of real takings into a shortfall against a real person. Attributing
   * them by the old window rule is exactly what happened to them before, so nothing moves.
   * Measured on production before writing this: two such payments exist, both inside a
   * single shift's window, none straddling two — so the arm is unambiguous today and only
   * ever shrinks.
   *
   * Called without a shift id, it is the old query, unchanged: the depot-wide daily report
   * genuinely wants every till at once.
   */
  async sumDepotCash(
    depotId: string,
    range: DateRange,
    cashierShiftId?: string,
  ): Promise<CashCollectedSummary> {
    const agg = await this.prisma.payment.aggregate({
      where: {
        depotId,
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
        ...(cashierShiftId
          ? {
              OR: [
                { cashierShiftId },
                { cashierShiftId: null, paidAt: { gte: range.from, lte: range.to } },
              ],
            }
          : { paidAt: { gte: range.from, lte: range.to } }),
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return { total: agg._sum.amount ? Number(agg._sum.amount) : 0, count: agg._count._all };
  }

  async update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord> {
    const row = await this.prisma.payment.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }

  async updateIfStatus(
    id: string,
    expected: PaymentStatus[],
    patch: PaymentStatusPatch,
  ): Promise<PaymentRecord | null> {
    // updateMany carries the predicate; `update` cannot filter on anything but a unique
    // field, which is exactly why the old write matched on `id` alone (B-9).
    const claimed = await this.prisma.payment.updateMany({
      where: { id, status: { in: expected } },
      data: patch,
    });
    if (claimed.count === 0) return null;
    const row = await this.prisma.payment.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }
}
