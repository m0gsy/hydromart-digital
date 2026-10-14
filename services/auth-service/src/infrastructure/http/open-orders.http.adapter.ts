import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { OpenOrdersPort } from '../../application/ports/open-orders.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * order-service's count of a customer's open orders, over the shared INTERNAL_SERVICE_KEY.
 * Same shape as HrDirectoryHttpAdapter: timeout, internal key, no retry, and every failure
 * raises — see the port for why this one must not guess.
 */
@Injectable()
export class OpenOrdersHttpAdapter implements OpenOrdersPort {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly config: AuthConfigService) {}

  async countOpen(customerId: string): Promise<number> {
    const base = this.config.serviceUrl('ORDER_SERVICE_URL');
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      throw new ServiceUnavailableException(
        'ORDER_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset; pesanan terbuka tidak bisa diperiksa.',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OpenOrdersHttpAdapter.TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(
        `${base}/api/v1/orders/internal/customer-open-count?customerId=${encodeURIComponent(customerId)}`,
        { headers: { 'x-internal-key': key }, signal: controller.signal },
      );
    } catch (error) {
      throw new ServiceUnavailableException(
        `order-service tidak terjangkau: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(`order-service menolak permintaan (${response.status})`);
    }
    const body = (await response.json().catch(() => null)) as { openCount?: unknown } | null;
    const n = body?.openCount;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) {
      throw new ServiceUnavailableException('order-service mengembalikan hasil yang tidak dikenali.');
    }
    return n;
  }
}
