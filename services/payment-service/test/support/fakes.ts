import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { PaymentConfigService } from '../../src/config/payment-config.service';
import { PaymentMethod, PaymentStatus, RefundApproval } from '../../src/domain/payment';
import {
  CashCollectedSummary,
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
      cashReceived: null,
      changeGiven: null,
      depotId: data.depotId ?? null,
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
  async search(
    query: PaymentQuery,
  ): Promise<{ items: PaymentRecord[]; total: number; nextCursor: string | null }> {
    const all = this.rows
      .filter((r) => !query.customerId || r.customerId === query.customerId)
      .filter((r) => !query.orderId || r.orderId === query.orderId)
      .filter((r) => !query.status || r.status === query.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    // Models the real repository: a cursor seeks past that row and ignores `page`.
    const start = query.cursor
      ? all.findIndex((r) => r.id === query.cursor) + 1
      : (query.page - 1) * query.limit;
    const items = all.slice(start, start + query.limit);
    return {
      items: items.map((r) => ({ ...r })),
      total: all.length,
      nextCursor: items.length === query.limit ? (items[items.length - 1]?.id ?? null) : null,
    };
  }
  async refundCountsByCustomer(
    from: Date,
    to: Date,
    minRefunds: number,
  ): Promise<{ customerId: string; refunds: number; amountIdr: number }[]> {
    const byCustomer = new Map<string, { refunds: number; amountIdr: number }>();
    for (const r of this.rows) {
      if (r.status !== PaymentStatus.REFUNDED || !r.refundedAt) continue;
      if (r.refundedAt < from || r.refundedAt > to) continue;
      const row = byCustomer.get(r.customerId) ?? { refunds: 0, amountIdr: 0 };
      row.refunds += 1;
      row.amountIdr += Math.round(r.refundedAmount ?? 0);
      byCustomer.set(r.customerId, row);
    }
    return [...byCustomer.entries()]
      .filter(([, v]) => v.refunds >= minRefunds)
      .map(([customerId, v]) => ({ customerId, ...v }))
      .sort((a, b) => b.refunds - a.refunds);
  }

  async findByOrderIds(orderIds: string[]): Promise<PaymentRecord[]> {
    return this.rows
      .filter((r) => orderIds.includes(r.orderId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({ ...r }));
  }
  async listPendingRefunds(query: {
    page: number;
    limit: number;
  }): Promise<{ items: PaymentRecord[]; total: number }> {
    const all = this.rows
      .filter((r) => r.refundApproval === RefundApproval.PENDING)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const start = (query.page - 1) * query.limit;
    return {
      items: all.slice(start, start + query.limit).map((r) => ({ ...r })),
      total: all.length,
    };
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

  async aggregateRevenueByMethod(range: DateRange): Promise<UnsettledMethodAggregate[]> {
    const map = new Map<PaymentMethod, { amount: number; count: number }>();
    for (const r of this.rows) {
      if (r.status !== PaymentStatus.PAID) continue;
      if (range.from && r.createdAt < range.from) continue;
      if (range.to && r.createdAt > range.to) continue;
      const e = map.get(r.method) ?? { amount: 0, count: 0 };
      e.amount += r.amount;
      e.count += 1;
      map.set(r.method, e);
    }
    return [...map.entries()].map(([method, v]) => ({ method, ...v }));
  }

  async sumCashCollected(orderIds: string[]): Promise<CashCollectedSummary> {
    const set = new Set(orderIds);
    const matched = this.rows.filter(
      (r) =>
        set.has(r.orderId) && r.method === PaymentMethod.CASH && r.status === PaymentStatus.PAID,
    );
    return { total: matched.reduce((s, r) => s + r.amount, 0), count: matched.length };
  }

  async cashByOrder(orderIds: string[]): Promise<{ orderId: string; amountIdr: number }[]> {
    const set = new Set(orderIds);
    const by = new Map<string, number>();
    for (const r of this.rows) {
      if (!set.has(r.orderId)) continue;
      if (r.method !== PaymentMethod.CASH || r.status !== PaymentStatus.PAID) continue;
      by.set(r.orderId, (by.get(r.orderId) ?? 0) + r.amount);
    }
    return [...by.entries()].map(([orderId, amountIdr]) => ({ orderId, amountIdr }));
  }

  async sumDepotCash(
    depotId: string,
    range: { from?: Date; to?: Date },
  ): Promise<CashCollectedSummary> {
    const matched = this.rows.filter(
      (r) =>
        r.depotId === depotId &&
        r.method === PaymentMethod.CASH &&
        r.status === PaymentStatus.PAID &&
        (!range.from || (r.paidAt !== null && r.paidAt >= range.from)) &&
        (!range.to || (r.paidAt !== null && r.paidAt <= range.to)),
    );
    return { total: matched.reduce((s, r) => s + r.amount, 0), count: matched.length };
  }

  async update(id: string, patch: PaymentStatusPatch): Promise<PaymentRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, patch, { updatedAt: nextDate() });
    return { ...row };
  }

  /** Compare-and-set (B-9): applies the patch only if the row is still in `expected`. */
  async updateIfStatus(
    id: string,
    expected: PaymentStatus[],
    patch: PaymentStatusPatch,
  ): Promise<PaymentRecord | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || !expected.includes(row.status)) return null;
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
  /** Every gateway refund actually sent. Money leaves per entry, so length is the assertion. */
  refunds: { reference: string; amount: number }[] = [];
  async refund(reference: string, amount: number): Promise<RefundResult> {
    if (this.throwOnRefund) {
      throw new Error('refund gateway down');
    }
    this.refunds.push({ reference, amount });
    return { reference: `RFN-${reference}`, raw: JSON.stringify({ refunded: amount }) };
  }
}

export class FakeOrderCoordination implements OrderCoordinationPort {
  confirmedOrderIds: string[] = [];
  refunded: { orderId: string; amount: number }[] = [];
  /** null = coordination disabled (validation skipped); a number = authoritative order total. */
  orderTotal: number | null = null;
  async getOrderTotal(): Promise<number | null> {
    return this.orderTotal;
  }
  async confirmPaid(orderId: string): Promise<void> {
    this.confirmedOrderIds.push(orderId);
  }
  async notifyRefunded(orderId: string, amount: number): Promise<void> {
    this.refunded.push({ orderId, amount });
  }
  /** orderId -> HM-… number. Empty = order-service could not be read (fail-soft). */
  orderNumbers = new Map<string, string>();
  async getOrderNumbers(orderIds: string[]): Promise<Map<string, string>> {
    return new Map(orderIds.filter((id) => this.orderNumbers.has(id)).map((id) => [id, this.orderNumbers.get(id)!]));
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
