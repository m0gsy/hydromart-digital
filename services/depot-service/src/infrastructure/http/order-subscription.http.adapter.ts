import { Injectable } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { EngineUnavailableError } from '../../domain/errors';
import {
  CreateEngineSubscriptionInput,
  OrderSubscriptionPort,
} from '../../application/ports/order-subscription.port';

/**
 * Creates the engine-side subscription for a depot-created plan (D10), over the shared
 * INTERNAL_SERVICE_KEY (the gateway strips that header inbound, so it only ever travels
 * service-to-service).
 *
 * Fails CLOSED. A depot row saved without its engine subscription is precisely the thing
 * D10 removes — a plan the console shows and nothing runs — so the operator is told while
 * they are still on the screen. The engine's own refusals travel through as their own
 * message: "this customer has no saved address" is something an operator can act on, and
 * flattening it to "failed" would waste that.
 */
@Injectable()
export class OrderSubscriptionHttpAdapter implements OrderSubscriptionPort {
  private static readonly TIMEOUT_MS = 8000;

  constructor(private readonly config: DepotConfigService) {}

  async create(input: CreateEngineSubscriptionInput): Promise<string> {
    const { orderServiceUrl, internalServiceKey } = this.config;
    if (!orderServiceUrl || !internalServiceKey) {
      throw new EngineUnavailableError('Integrasi order-service belum dikonfigurasi.');
    }
    const res = await fetch(`${orderServiceUrl}/api/v1/subscriptions/internal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
      body: JSON.stringify({
        customerId: input.customerId,
        productId: input.productId,
        quantity: input.quantity,
        frequency: input.frequency,
        firstDeliveryAt: input.firstDeliveryAt.toISOString(),
      }),
      signal: AbortSignal.timeout(OrderSubscriptionHttpAdapter.TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok || !body?.id) {
      // The engine's own words when it has them — it knows why far better than this layer.
      throw new EngineUnavailableError(body?.message ?? `order-service responded ${res.status}`);
    }
    return body.id;
  }
}
