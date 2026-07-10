import { Injectable } from '@nestjs/common';

import { PaymentMethod, PaymentStatus } from '../../domain/payment';
import {
  CreatePaymentData,
  PaymentQuery,
  PaymentRecord,
  PaymentRepository,
  PaymentStatusPatch,
} from '../../application/ports/payment.repository';
import { PrismaService } from './prisma.service';

type Decimalish = { toNumber(): number };

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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreatePaymentData): Promise<PaymentRecord> {
    const row = await this.prisma.payment.create({ data });
    return this.toRecord(row);
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

  async update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord> {
    const row = await this.prisma.payment.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }
}
