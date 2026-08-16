import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { CourierCodPort, DepositedCod } from '../../application/ports/courier-cod.port';
import { DepotConfigService } from '../../config/depot-config.service';

/**
 * Reads the COD a depot accepted from delivery-service's internal endpoint, over the shared
 * INTERNAL_SERVICE_KEY (the gateway strips that header inbound, so it only ever travels
 * service-to-service).
 *
 * Fails CLOSED, exactly like DepotCashHttpAdapter next to it and for the same reason: this
 * number goes into a signed-off daily total. Answering 0 because delivery-service blinked
 * would record a day as counted while half its money is missing from the record.
 */
@Injectable()
export class CourierCodHttpAdapter implements CourierCodPort {
  private static readonly TIMEOUT_MS = 5000;

  constructor(private readonly config: DepotConfigService) {}

  async depositedInWindow(depotId: string, from: Date, to: Date): Promise<DepositedCod> {
    const { deliveryServiceUrl, internalServiceKey } = this.config;
    if (!deliveryServiceUrl || !internalServiceKey) {
      throw new ServiceUnavailableException(
        'DELIVERY_SERVICE_URL/INTERNAL_SERVICE_KEY belum diset; buku harian tidak bisa ditutup.',
      );
    }
    const query = new URLSearchParams({
      depotId,
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CourierCodHttpAdapter.TIMEOUT_MS);
    try {
      const res = await fetch(
        `${deliveryServiceUrl}/api/v1/settlements/internal/deposited?${query.toString()}`,
        { headers: { 'x-internal-key': internalServiceKey }, signal: controller.signal },
      );
      if (!res.ok) {
        throw new ServiceUnavailableException(`delivery-service menjawab ${res.status}`);
      }
      const body = (await res.json()) as Partial<DepositedCod>;
      // E-6: this used to be `Number(body.x ?? 0)`. A 200 whose body is missing a figure
      // is not a depot that took no cash — it is an answer we could not read, and the day
      // book was being closed on the difference. Every other failure in this file throws;
      // this was the one hole. A non-numeric value is the same unreadable answer.
      const read = (value: unknown, field: string): number => {
        const n = Number(value);
        if (value == null || !Number.isFinite(n)) {
          throw new ServiceUnavailableException(
            `delivery-service menjawab tanpa ${field} yang terbaca; setoran tidak bisa dihitung.`,
          );
        }
        return n;
      };
      return {
        depositedIdr: read(body.depositedIdr, 'depositedIdr'),
        expectedIdr: read(body.expectedIdr, 'expectedIdr'),
        settlements: read(body.settlements, 'settlements'),
      };
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      throw new ServiceUnavailableException(
        `delivery-service tidak terjangkau: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
