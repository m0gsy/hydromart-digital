import { Injectable, Logger } from '@nestjs/common';

import { HTTP_STATUS } from '@hydromart/platform';

import { OrderConfigService } from '../../config/order-config.service';
import { InsufficientStockError, StockCheckUnavailableError } from '../../domain/errors';
import { InventoryPort, SoldLine } from '../../application/ports/inventory.port';

/**
 * Moves stock on the fulfilling depot via depot-service. Authenticated
 * service-to-service with the shared INTERNAL_SERVICE_KEY (SEC-2), not a forwarded
 * end-user token. depot-service skips products it does not stock.
 *
 * The four calls here do NOT share a failure policy, and the difference is deliberate:
 *
 * - `reserve` fails CLOSED. It runs *before* the sale is promised, so an unverifiable
 *   result must reject the checkout — see B-6b on the method itself.
 * - `consume`, `restock` and `release` fail OPEN. They run *after* an order has already
 *   changed state, so throwing would block a completion, a void or a cancellation that
 *   has otherwise succeeded, and strand the order instead of the stock line. The stock
 *   drift they can leave behind is real and is what the reconciliation sweep is for; it
 *   is the lesser of the two failures, which is not true of reserve.
 */
@Injectable()
export class InventoryHttpAdapter implements InventoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(InventoryHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  /** Internal-key header for depot-service stock calls, or null when unconfigured (skip). */
  private internalHeaders(): Record<string, string> | null {
    const key = this.config.internalServiceKey;
    if (!key) {
      return null;
    }
    return { 'content-type': 'application/json', 'x-internal-key': key };
  }

  async consume(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    _authorization: string,
  ): Promise<void> {
    const headers = this.internalHeaders();
    if (!headers) {
      this.logger.warn(`No internal key; skipped stock consume for order ${orderId}`);
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
        headers,
        body: JSON.stringify({ orderId, items }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Stock consume skipped for order ${orderId}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Hold stock for a pending order. Unlike the other three calls here, this one fails
   * CLOSED (B-6b).
   *
   * Reserve is what makes a sale safe to promise, so "we could not check" must not be
   * treated as "it is fine". It previously rethrew only on an explicit 422 and swallowed
   * everything else, which meant a depot-service outage did not stop sales — it silently
   * converted every order placed during the outage into an unreserved one, with no error
   * anywhere and a divergence that compounded with the settle race (B-5).
   *
   * Exactly one skip is safe and it is enumerated below: an empty cart, where there is
   * genuinely nothing to hold. A missing internal key is a deployment fault, not a
   * business condition, and gets the same rejection as an unreachable depot — quietly
   * selling unreserved stock because a config value is blank is the worse failure.
   */
  async reserve(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    _authorization: string,
  ): Promise<void> {
    if (items.length === 0) {
      return; // nothing to hold — the only safe skip
    }
    const headers = this.internalHeaders();
    if (!headers) {
      this.logger.error(
        `No internal key configured; refusing to reserve stock for order ${orderId}`,
      );
      throw new StockCheckUnavailableError();
    }
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/reserve`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), InventoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
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
        throw error; // the depot gave a verdict: not enough stock
      }
      // Timeout, 5xx, DNS, refused connection, bad key — no verdict was reached, so the
      // checkout is rejected rather than allowed through unreserved.
      this.logger.error(`Stock reserve failed for order ${orderId}: ${(error as Error).message}`);
      throw new StockCheckUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }

  async restock(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    _authorization: string,
  ): Promise<void> {
    const headers = this.internalHeaders();
    if (!headers || items.length === 0) {
      return;
    }
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/restock`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), InventoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ orderId, items }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Stock restock skipped for order ${orderId}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async release(
    depotId: string,
    orderId: string,
    items: SoldLine[],
    _authorization: string,
  ): Promise<void> {
    const headers = this.internalHeaders();
    if (!headers || items.length === 0) {
      return;
    }
    const url = `${this.config.depotServiceUrl}/api/v1/depots/${depotId}/inventory/release`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), InventoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ orderId, items }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`depot-service responded ${res.status}`);
      }
    } catch (error) {
      this.logger.warn(`Stock release skipped for order ${orderId}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
