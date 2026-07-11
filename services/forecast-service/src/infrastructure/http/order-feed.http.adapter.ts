import { Injectable } from '@nestjs/common';

import { IngestCommand, IngestItem } from '../../application/ports/forecast.repository';
import { OrderFeedPort } from '../../application/ports/order-feed.port';
import { ForecastConfigService } from '../../config/forecast-config.service';

const TIMEOUT_MS = 5_000;

interface CompletedOrderResponse {
  id: string;
  depotId?: string | null;
  completedAt?: string;
  updatedAt?: string;
  items: IngestItem[];
}

interface CompletedOrdersPageResponse {
  orders: CompletedOrderResponse[];
  nextCursor: string | null;
}

/**
 * Consumes order-service's `GET /api/v1/orders/internal/completed` feed (its item shape
 * carries `quantity`). Fails open to an empty page on missing config, non-2xx, timeout, or
 * network error — the rebuild loop just stops early rather than crashing; a subsequent rebuild
 * run picks up where it left off via the cursor.
 */
@Injectable()
export class OrderFeedHttpAdapter implements OrderFeedPort {
  constructor(private readonly config: ForecastConfigService) {}

  async fetchCompleted(cursor: string | null, limit: number): Promise<{ orders: IngestCommand[]; nextCursor: string | null }> {
    const baseUrl = this.config.orderServiceUrl;
    const key = this.config.internalServiceKey;
    if (!baseUrl || !key) return { orders: [], nextCursor: null };

    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}/api/v1/orders/internal/completed?${params.toString()}`, {
        headers: { 'x-internal-key': key },
        signal: controller.signal,
      });
      if (!res.ok) return { orders: [], nextCursor: null };

      const page = (await res.json()) as CompletedOrdersPageResponse;
      return {
        orders: page.orders.map((order) => ({
          orderId: order.id,
          depotId: order.depotId ?? null,
          items: order.items,
          at: new Date(order.completedAt ?? order.updatedAt ?? Date.now()),
        })),
        nextCursor: page.nextCursor,
      };
    } catch {
      return { orders: [], nextCursor: null };
    } finally {
      clearTimeout(timeout);
    }
  }
}
