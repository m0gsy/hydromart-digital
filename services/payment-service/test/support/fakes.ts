import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PaymentConfigService } from '../../src/config/payment-config.service';
import { PaymentMethod, PaymentStatus, RefundApproval } from '../../src/domain/payment';
import {
  CreatePaymentData,
  DateRange,
  PaymentQuery,
  PaymentRecord,
  PaymentRepository,
  PaymentStatusPatch,
  UnsettledMethodAggregate,
} from '../../src/application/ports/payment.repository';
import {
  ChargeRequest,
  ChargeResult,
  PaymentGatewayPort,
  RefundResult,
} from '../../src/application/ports/payment-gateway.port';
import { OrderCoordinationPort } from '../../src/application/ports/order-coordination.port';

let seq = 0;
const nextDate = (): Date => new Date(1_800_000_000_000 + (seq += 1) * 1000);

const ACTIVE: PaymentStatus[] = [PaymentStatus.PENDING, PaymentStatus.PAID];

export class InMemoryPaymentRepository implements PaymentRepository {
  rows: PaymentRecord[] = [];

  async create(data: CreatePaymentData): Promise<PaymentRecord> {
    const now = nextDate();
    const rec: PaymentRecord = {
      ...data,
      id: randomUUID(),
      status: PaymentStatus.PENDING,
      paidAt: null,
      failedAt: null,
      refundedAt: null,
      refundReason: null,
      refundedAmount: null,
      refundApproval: RefundApproval.NONE,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(rec);
    return { ...rec };
  }
  async findById(id: string): Promise<PaymentRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }
  async findActiveByOrder(orderId: string): Promise<PaymentRecord | null> {
    const row = this.rows.find((r) => r.orderId === orderId && ACTIVE.includes(r.status));
    return row ? { ...row } : null;
  }
  async findByReference(reference: string): Promise<PaymentRecord | null> {
    const row = this.rows.find((r) => r.reference === reference);
    return row ? { ...row } : null;
  }
  async search(query: PaymentQuery): Promise<{ items: PaymentRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => !query.customerId || r.customerId === query.customerId)
      .filter((r) => !query.orderId || r.orderId === query.orderId)
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit).map((r) => ({ ...r })),
      total: all.length,
    };
  }
  async listPendingRefunds(query: {
    page: number;
    limit: number;
  }): Promise<{ items: PaymentRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => r.refundApproval === RefundApproval.PENDING)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const start = (query.page - 1) * query.limit;
    return { items: all.slice(start, start + query.limit).map((r) => ({ ...r })), total: all.length };
  }
  async aggregateUnsettledByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    const map = new Map<PaymentMethod, { amount: number; count: number }>();
    for (const r of this.rows) {
      if (r.status !== PaymentStatus.PENDING) continue;
      if (range.from && r.createdAt < range.from) continue;
      if (range.to && r.createdAt > range.to) continue;
      const e = map.get(r.method) ?? { amount: 0, count: 0 };
      e.amount += r.amount;
      e.count += 1;
      map.set(r.method, e);
    }
    return [...map.entries()].map(([method, v]) => ({ method, ...v }));
  }

  async update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, patch, { updatedAt: nextDate() });
    return { ...row };
  }
}

export class FakeGateway implements PaymentGatewayPort {
  throwOnCharge = false;
  throwOnRefund = false;
  charges: ChargeRequest[] = [];

  async createCharge(request: ChargeRequest): Promise<ChargeResult> {
    if (this.throwOnCharge) {
      throw new Error('gateway down');
    }
    this.charges.push(request);
    return {
      reference: `REF-${request.paymentId.slice(0, 8)}`,
      instruction: `Pay ${request.amount} via ${request.method}.`,
      raw: JSON.stringify({ ok: true }),
    };
  }
  async refund(reference: string, amount: number): Promise<RefundResult> {
    if (this.throwOnRefund) {
      throw new Error('refund gateway down');
    }
    return { reference: `RFN-${reference}`, raw: JSON.stringify({ refunded: amount }) };
  }
}

export class FakeOrderCoordination implements OrderCoordinationPort {
  confirmedOrderIds: string[] = [];
  async confirmPaid(orderId: string): Promise<void> {
    this.confirmedOrderIds.push(orderId);
  }
}

export const WEBHOOK_SECRET = 'test-webhook-secret-01';

export function buildTestConfig(overrides: Record<string, string> = {}): PaymentConfigService {
  const env: Record<string, string> = {
    NODE_ENV: 'test',
    PAYMENT_SERVICE_PORT: '3005',
    PAYMENT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
    PAYMENT_GATEWAY_BASE_URL: '',
    PAYMENT_GATEWAY_API_KEY: '',
    PAYMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    ...overrides,
  };
  const fake = {
    get: <T>(k: string, d?: T): T => (env[k] as unknown as T) ?? (d as T),
    getOrThrow: (k: string): string => {
      if (env[k] === undefined) throw new Error(`missing ${k}`);
      return env[k];
    },
  };
  return new PaymentConfigService(fake as unknown as ConfigService);
}
