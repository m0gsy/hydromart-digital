import { Injectable } from '@nestjs/common';

import {
  AccountByPhonePort,
  OrderPaymentRow,
  PaymentsOfOrdersPort,
} from '../../application/ports/outreach-lookups.port';
import { OrderConfigService } from '../../config/order-config.service';

const TIMEOUT_MS = 5000;

async function postInternal(base: string, key: string, path: string, body: unknown, what: string): Promise<unknown> {
  if (!base || !key) throw new Error(`${what}: URL or internal key missing`);
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${what} responded ${res.status}`);
  return res.json();
}

/** auth-service `customers/by-phone`: read-only, so a status question never mints an account. */
@Injectable()
export class AccountByPhoneHttpAdapter implements AccountByPhonePort {
  constructor(private readonly config: OrderConfigService) {}

  async customerIdByPhone(phone: string): Promise<string | null> {
    const body = (await postInternal(
      this.config.authServiceUrl,
      this.config.internalServiceKey,
      '/api/v1/auth/internal/customers/by-phone',
      { phone },
      'auth-service',
    )) as { customerId?: unknown } | null;
    return typeof body?.customerId === 'string' ? body.customerId : null;
  }
}

/** payment-service `payments/for-orders` (newest first), over the internal key. */
@Injectable()
export class PaymentsOfOrdersHttpAdapter implements PaymentsOfOrdersPort {
  constructor(private readonly config: OrderConfigService) {}

  async latestByOrder(orderIds: string[]): Promise<Map<string, OrderPaymentRow>> {
    const out = new Map<string, OrderPaymentRow>();
    if (orderIds.length === 0) return out;
    const rows = await postInternal(
      this.config.paymentServiceUrl,
      this.config.internalServiceKey,
      '/api/v1/payments/for-orders',
      { orderIds },
      'payment-service',
    );
    if (!Array.isArray(rows)) throw new Error('payment-service answered something malformed');
    for (const r of rows as (Record<string, unknown> | null)[]) {
      // Newest first: the first row seen for an order is its current payment.
      if (r && typeof r.orderId === 'string' && typeof r.method === 'string' && typeof r.status === 'string' && !out.has(r.orderId)) {
        out.set(r.orderId, { orderId: r.orderId, method: r.method, status: r.status });
      }
    }
    return out;
  }
}
