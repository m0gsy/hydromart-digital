import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { CustomerFootprintPort } from '../../application/ports/customer-footprint.port';
import { AuthConfigService } from '../../config/auth-config.service';

/**
 * order-service's order and subscription counts plus loyalty-service's point balance, over the
 * shared INTERNAL_SERVICE_KEY. Same shape as OpenOrdersHttpAdapter: timeout, internal key, no
 * retry, and every failure raises — see the port for why this one must not guess.
 */
@Injectable()
export class CustomerFootprintHttpAdapter implements CustomerFootprintPort {
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly config: AuthConfigService) {}

  async isUnused(customerId: string): Promise<boolean> {
    const id = encodeURIComponent(customerId);
    const [activity, loyalty] = await Promise.all([
      this.read('ORDER_SERVICE_URL', `/api/v1/orders/internal/customer-activity?customerId=${id}`),
      // Creates an empty loyalty account when there is none, which answers 0 all the same.
      this.read('LOYALTY_SERVICE_URL', `/api/v1/loyalty/accounts/${id}`),
    ]);
    // Never had a point, not merely none left: a referral reward spent to zero is history too,
    // and some movements change the balance and the lifetime total by different amounts.
    return (
      count(activity.orders) === 0 &&
      count(activity.subscriptions) === 0 &&
      count(loyalty.pointsBalance) === 0 &&
      count(loyalty.lifetimePoints) === 0
    );
  }

  private async read(envKey: string, path: string): Promise<Record<string, unknown>> {
    const base = this.config.serviceUrl(envKey);
    const key = this.config.internalServiceKey;
    if (!base || !key) {
      throw new ServiceUnavailableException(
        `${envKey}/INTERNAL_SERVICE_KEY belum diset; riwayat akun pelanggan tidak bisa diperiksa.`,
      );
    }
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        headers: { 'x-internal-key': key },
        signal: AbortSignal.timeout(CustomerFootprintHttpAdapter.TIMEOUT_MS),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `${base} tidak terjangkau: ${(error as Error).message}`,
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(`${base} menolak permintaan (${response.status})`);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      throw new ServiceUnavailableException(`${base} mengembalikan hasil yang tidak dikenali.`);
    }
    return body as Record<string, unknown>;
  }
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ServiceUnavailableException(
      'Riwayat akun pelanggan mengembalikan angka yang tidak dikenali.',
    );
  }
  return value;
}
