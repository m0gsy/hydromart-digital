import { Injectable, Logger } from '@nestjs/common';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  DepotCustomerOrder,
  DepotCustomerOrderStats,
  OrderCrmPort,
} from '../../application/ports/order-crm.port';

interface RawStat {
  customerId: string;
  name: string | null;
  phone: string | null;
  orderCount: number;
  totalSpent: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

/**
 * Fetches per-customer order aggregates from order-service's internal endpoint.
 * Fails SOFT: any error / missing config → [] so the CRM directory + dashboard render
 * with "no order data" instead of 500ing.
 */
@Injectable()
export class OrderCrmHttpAdapter implements OrderCrmPort {
  private static readonly TIMEOUT_MS = 5_000;
  private readonly logger = new Logger(OrderCrmHttpAdapter.name);

  constructor(private readonly config: CustomerConfigService) {}

  async depotCustomerStats(depotId: string): Promise<DepotCustomerOrderStats[]> {
    const url = this.config.orderServiceUrl;
    const key = this.config.internalServiceKey;
    if (!url || !key) return [];
    try {
      const res = await fetch(
        `${url.replace(/\/$/, '')}/api/v1/orders/internal/depot-customers?depotId=${encodeURIComponent(depotId)}`,
        // Audit F-3: this adapter had no deadline. It fails soft, so a hung order-service
        // did not error — it held the CRM directory request open until the proxy gave up.
        {
          headers: { 'x-internal-key': key },
          signal: AbortSignal.timeout(OrderCrmHttpAdapter.TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.warn(`depot-customers ${res.status} for depot ${depotId}`);
        return [];
      }
      const body = (await res.json()) as { customers?: RawStat[] };
      return (body.customers ?? []).map((c) => ({
        customerId: c.customerId,
        name: c.name,
        phone: c.phone,
        orderCount: c.orderCount,
        totalSpent: c.totalSpent,
        firstOrderAt: c.firstOrderAt ? new Date(c.firstOrderAt) : null,
        lastOrderAt: c.lastOrderAt ? new Date(c.lastOrderAt) : null,
      }));
    } catch (err) {
      this.logger.warn(`depot-customers fetch failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  async customerOrders(depotId: string, customerId: string): Promise<DepotCustomerOrder[]> {
    const url = this.config.orderServiceUrl;
    const key = this.config.internalServiceKey;
    if (!url || !key) return [];
    const qs = `depotId=${encodeURIComponent(depotId)}&customerId=${encodeURIComponent(customerId)}`;
    try {
      const res = await fetch(
        `${url.replace(/\/$/, '')}/api/v1/orders/internal/customer-orders?${qs}`,
        {
          headers: { 'x-internal-key': key },
          signal: AbortSignal.timeout(OrderCrmHttpAdapter.TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.warn(`customer-orders ${res.status} for customer ${customerId}`);
        return [];
      }
      const body = (await res.json()) as { orders?: DepotCustomerOrder[] };
      return body.orders ?? [];
    } catch (err) {
      this.logger.warn(`customer-orders fetch failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
