import { Injectable } from '@nestjs/common';

import {
  Counted,
  CustomerReminderSourcePort,
  DueSubscription,
  ExpiringPointLot,
  UnpaidOrder,
} from '../../application/ports/customer-reminder-source.port';
import { CrmConfigService } from '../../config/crm-config.service';

const TIMEOUT_MS = 10_000;

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || !v) throw new Error(`${what} answered something malformed`);
  return v;
};
const num = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} answered something malformed`);
  return v;
};
const at = (v: unknown, what: string): Date => {
  const d = new Date(str(v, what));
  if (Number.isNaN(d.getTime())) throw new Error(`${what} answered something malformed`);
  return d;
};

/** order-service and loyalty-service internal routes, over the shared internal key. */
@Injectable()
export class CustomerReminderSourceHttpAdapter implements CustomerReminderSourcePort {
  constructor(private readonly config: CrmConfigService) {}

  private async call(base: string, path: string, what: string, init: RequestInit = {}): Promise<{ list: unknown[]; truncated: boolean }> {
    const key = this.config.internalServiceKey;
    if (!base || !key) throw new Error(`${what} URL or internal key missing`);
    const res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', 'x-internal-key': key },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${what} responded ${res.status}`);
    const body = (await res.json()) as { items?: unknown; lots?: unknown; truncated?: unknown } | null;
    const list = body?.items ?? body?.lots;
    if (!Array.isArray(list)) throw new Error(`${what} answered something malformed`);
    return { list, truncated: body?.truncated === true };
  }

  async subscriptionsDue(from: Date, to: Date): Promise<Counted<DueSubscription>> {
    const { list: rows, truncated } = await this.call(
      this.config.orderServiceUrl,
      '/api/v1/customer-reminders/internal/subscriptions-due',
      'order-service',
      { method: 'POST', body: JSON.stringify({ from: from.toISOString(), to: to.toISOString() }) },
    );
    const mapped = (rows as Record<string, unknown>[]).map((r) => ({
      id: str(r.id, 'order-service'),
      customerId: str(r.customerId, 'order-service'),
      productName: str(r.productName, 'order-service'),
      quantity: num(r.quantity, 'order-service'),
      nextDeliveryAt: at(r.nextDeliveryAt, 'order-service'),
    }));
    return { rows: mapped, truncated };
  }

  async expiringPoints(withinDays: number): Promise<Counted<ExpiringPointLot>> {
    const { list: rows, truncated } = await this.call(
      this.config.loyaltyServiceUrl,
      `/api/v1/loyalty/internal/expiring-lots?withinDays=${withinDays}`,
      'loyalty-service',
    );
    const mapped = (rows as Record<string, unknown>[]).map((r) => ({
      lotId: str(r.lotId, 'loyalty-service'),
      customerId: str(r.customerId, 'loyalty-service'),
      points: num(r.points, 'loyalty-service'),
      expiresAt: at(r.expiresAt, 'loyalty-service'),
    }));
    return { rows: mapped, truncated };
  }

  async unpaidOrders(): Promise<Counted<UnpaidOrder>> {
    const { list: rows, truncated } = await this.call(
      this.config.orderServiceUrl,
      '/api/v1/customer-reminders/internal/unpaid-orders',
      'order-service',
      { method: 'POST', body: '{}' },
    );
    const mapped = (rows as Record<string, unknown>[]).map((r) => ({
      orderId: str(r.orderId, 'order-service'),
      customerId: str(r.customerId, 'order-service'),
      orderNumber: str(r.orderNumber, 'order-service'),
      total: num(r.total, 'order-service'),
    }));
    return { rows: mapped, truncated };
  }
}
