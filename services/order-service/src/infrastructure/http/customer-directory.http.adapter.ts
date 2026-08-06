import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { CustomerDirectoryPort } from '../../application/ports/customer-directory.port';

/**
 * Tells customer-service where a customer just bought (§I), over the shared internal key.
 *
 * Internal rather than the customer's own bearer: a counter sale is rung up on the
 * cashier's token, and the subscription runner has no token at all, so a caller-token route
 * would work for exactly one of the three order paths.
 *
 * Fails OPEN, like every other non-critical checkout call: the order exists whatever
 * happens here, and the worst case is the customer stays out of that depot's directory
 * until their next order.
 */
@Injectable()
export class CustomerDirectoryHttpAdapter implements CustomerDirectoryPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(CustomerDirectoryHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async claimFavoriteDepot(customerId: string, depotId: string): Promise<boolean> {
    const key = this.config.internalServiceKey;
    if (!key) return false;
    const url = `${this.config.customerServiceUrl}/api/v1/customers/internal/favorite-depot`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CustomerDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ customerId, depotId }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const body = (await res.json().catch(() => null)) as { claimed?: boolean } | null;
      return body?.claimed === true;
    } catch (error) {
      this.logger.warn(`Favourite depot not recorded: ${(error as Error).message}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async resolveByPhone(phone: string, fullName: string, depotId: string): Promise<string | null> {
    const key = this.config.internalServiceKey;
    if (!key) return null;
    const url = `${this.config.customerServiceUrl}/api/v1/customers/internal/resolve-by-phone`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CustomerDirectoryHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
        body: JSON.stringify({ phone, fullName, depotId }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`customer-service responded ${res.status}`);
      const body = (await res.json().catch(() => null)) as { customerId?: string } | null;
      return body?.customerId ?? null;
    } catch (error) {
      // Fail OPEN like the rest of this adapter: the sale goes through as anonymous rather
      // than the cashier being stopped mid-transaction.
      this.logger.warn(`Counter buyer not resolved: ${(error as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
