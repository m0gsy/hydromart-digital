import { Injectable } from '@nestjs/common';

import { PaymentMethod, PaymentStatus, RefundApproval } from '../../domain/payment';
import {
  CashCollectedSummary,
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

  async findByReference(reference: string): Promise<PaymentRecord | null> {
    const row = await this.prisma.payment.findFirst({ where: { reference } });
    return row ? this.toRecord(row) : null;
  }

  async search(query: PaymentQuery): Promise<{ items: PaymentRecord[]; total: number }> {
    const where = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r)), total };
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

  async sumCashCollected(orderIds: string[]): Promise<CashCollectedSummary> {
    if (orderIds.length === 0) {
      return { total: 0, count: 0 };
    }
    const agg = await this.prisma.payment.aggregate({
      where: {
        orderId: { in: orderIds },
        method: PaymentMethod.CASH,
        status: PaymentStatus.PAID,
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
}
