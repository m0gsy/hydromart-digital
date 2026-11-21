import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { OrderLedgerPort } from '../../application/ports/order-ledger.port';

/** Asks order-service, over the shared INTERNAL_SERVICE_KEY, what one depot is still owed. */
@Injectable()
export class OrderLedgerHttpAdapter implements OrderLedgerPort {
  private static readonly TIMEOUT_MS = 8000;

  constructor(private readonly config: DepotConfigService) {}

  async pendingRevenue(depotId: string): Promise<number> {
    const { orderServiceUrl, internalServiceKey } = this.config;
    const refuse = () =>
      new ServiceUnavailableException(
        'Belum bisa memastikan pendapatan depot ini sudah dibukukan. Coba lagi sebentar lagi.',
      );
    if (!orderServiceUrl || !internalServiceKey) throw refuse();
    let res: Response;
    try {
      res = await fetch(
        `${orderServiceUrl}/api/v1/orders/outbox/internal/pending-revenue?depotId=${encodeURIComponent(depotId)}`,
        {
          headers: { 'x-internal-key': internalServiceKey },
          signal: AbortSignal.timeout(OrderLedgerHttpAdapter.TIMEOUT_MS),
        },
      );
    } catch {
      throw refuse();
    }
    const body = (await res.json().catch(() => null)) as { pending?: unknown } | null;
    if (!res.ok || typeof body?.pending !== 'number') throw refuse();
    return body.pending;
  }
}
