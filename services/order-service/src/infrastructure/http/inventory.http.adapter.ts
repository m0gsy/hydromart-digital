import { Injectable, Logger } from '@nestjs/common';

import { HTTP_STATUS } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import { InsufficientStockError } from '../../domain/errors';
import { InventoryPort, SoldLine } from '../../application/ports/inventory.port';

/**
 * Deducts sold quantities from the fulfilling depot's PRODUK stock on the
 * depot-service when an order completes. Fails OPEN: any error (depot-service
 * down, non-2xx, missing token) logs and returns, so completing an order is
 * never blocked. depot-service skips products it does not stock.
 */
@Injectable()
export class InventoryHttpAdapter implements InventoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(InventoryHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async consume(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void> {
    if (!authorization) {
      this.logger.warn(`No caller token; skipped stock consume for order ${orderId}`);
      return;
    }
    if (items.length === 0) {
      return;
    }
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/consume`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), InventoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ orderId, items }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Stock consume skipped for order ${orderId}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async reserve(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void> {
    if (!authorization || items.length === 0) {
      return; // no token / nothing to reserve — fail open
    }
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/reserve`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), InventoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ orderId, items }),
        signal: controller.signal,
      });
      if (res.status === HTTP_STATUS.UNPROCESSABLE) {
        // A genuine stock shortfall — reject the checkout with the depot's message.
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new InsufficientStockError(body?.message);
      }
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        throw error; // propagate the reject; everything else fails open
      }
      this.logger.warn(
        `Stock reserve skipped for order ${orderId}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async release(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    authorization: string,
  ): Promise<void> {
    if (!authorization || items.length === 0) {
      return;
    }
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/release`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), InventoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization },
        body: JSON.stringify({ orderId, items }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(
        `Stock release skipped for order ${orderId}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
