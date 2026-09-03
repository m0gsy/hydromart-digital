import { Injectable, Logger } from '@nestjs/common';

import { DeliveryConfigService } from '../../config/delivery-config.service';
import { EventPublisherPort } from '../../application/ports/event-publisher.port';

/**
 * Posts one event to admin-service's internal webhook ingest, authenticated by the shared
 * INTERNAL_SERVICE_KEY. admin-service owns the subscriptions, the signing and the retries;
 * this only has to report that the thing happened.
 *
 * Fails OPEN and says so in the log — see EventPublisherPort for why that is the right
 * default here and the wrong one for stock (B-6b).
 */
@Injectable()
export class EventPublisherHttpAdapter implements EventPublisherPort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(EventPublisherHttpAdapter.name);

  constructor(private readonly config: DeliveryConfigService) {}

  async publish(event: string, payload: Record<string, unknown>, occurredAt: Date): Promise<void> {
    const { adminServiceUrl, internalServiceKey } = this.config;
    if (!adminServiceUrl || !internalServiceKey) {
      this.logger.debug(`${event} not published (webhook fan-out not configured)`);
      return;
    }
    try {
      const res = await fetch(`${adminServiceUrl}/api/v1/webhooks/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({ event, payload, occurredAt: occurredAt.toISOString() }),
        signal: AbortSignal.timeout(EventPublisherHttpAdapter.TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
    } catch (error) {
      this.logger.warn(`${event} not published: ${(error as Error).message}`);
    }
  }
}
