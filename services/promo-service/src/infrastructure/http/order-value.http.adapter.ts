import { Injectable, Logger } from '@nestjs/common';

import { OrderValue, OrderValuePort } from '../../application/ports/order-value.port';
import { PromoConfigService } from '../../config/promo-config.service';

@Injectable()
export class OrderValueHttpAdapter implements OrderValuePort {
  private static readonly BATCH_SIZE = 500;
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(OrderValueHttpAdapter.name);

  constructor(private readonly config: PromoConfigService) {}

  async findOrderValues(orderIds: string[]): Promise<OrderValue[] | null> {
    if (orderIds.length === 0) return [];
    const { internalServiceKey, orderServiceUrl } = this.config;
    if (!internalServiceKey || !orderServiceUrl) return null;

    try {
      const values: OrderValue[] = [];
      for (let index = 0; index < orderIds.length; index += OrderValueHttpAdapter.BATCH_SIZE) {
        const batch = orderIds.slice(index, index + OrderValueHttpAdapter.BATCH_SIZE);
        const response = await fetch(`${orderServiceUrl}/api/v1/orders/internal/values`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
          body: JSON.stringify({ orderIds: batch }),
          signal: AbortSignal.timeout(OrderValueHttpAdapter.TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`order-service responded ${response.status}`);
        const body: unknown = await response.json();
        const parsed = this.parseCompleteBatch(body, batch);
        if (!parsed) throw new Error('order-service returned malformed or incomplete values');
        values.push(...parsed);
      }
      return values;
    } catch (error) {
      this.logger.warn(`Order values unavailable: ${(error as Error).message}`);
      return null;
    }
  }

  private parseCompleteBatch(body: unknown, requestedIds: string[]): OrderValue[] | null {
    if (!Array.isArray(body) || body.length !== requestedIds.length) return null;
    const requested = new Set(requestedIds);
    const seen = new Set<string>();
    const values: OrderValue[] = [];
    for (const item of body) {
      if (!item || typeof item !== 'object') return null;
      const { orderId, totalIdr } = item as Record<string, unknown>;
      if (
        typeof orderId !== 'string' ||
        !requested.has(orderId) ||
        seen.has(orderId) ||
        typeof totalIdr !== 'number' ||
        !Number.isSafeInteger(totalIdr) ||
        totalIdr < 0
      ) {
        return null;
      }
      seen.add(orderId);
      values.push({ orderId, totalIdr });
    }
    return seen.size === requested.size ? values : null;
  }
}
