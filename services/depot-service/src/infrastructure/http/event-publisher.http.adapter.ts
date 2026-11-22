import { Injectable } from '@nestjs/common';

import { DepotConfigService } from '../../config/depot-config.service';
import { EventPublisherPort } from '../../application/ports/event-publisher.port';

/**
 * HD-7: posts one event to admin-service's internal webhook ingest with the shared internal key.
 * admin-service owns the subscriptions, the signing and the retries to the receiver; this only
 * reports that the thing happened.
 *
 * Only the TRANSPORT: it throws whenever admin-service has not taken the event, and that
 * includes not being configured. delivery-service treats a missing ADMIN_SERVICE_URL as nothing
 * owed; here the event is a calon mitra waiting for a call back, so it stays in the outbox, and
 * the sweep reports the round as failing, until somebody configures it.
 */
@Injectable()
export class EventPublisherHttpAdapter implements EventPublisherPort {
  private static readonly TIMEOUT_MS = 5000;

  constructor(private readonly config: DepotConfigService) {}

  async publish(
    event: string,
    payload: Record<string, unknown>,
    occurredAt: Date,
    eventId: string,
  ): Promise<void> {
    const { adminServiceUrl, internalServiceKey } = this.config;
    if (!adminServiceUrl || !internalServiceKey) {
      throw new Error('admin-service is not configured (ADMIN_SERVICE_URL, INTERNAL_SERVICE_KEY)');
    }
    const res = await fetch(`${adminServiceUrl}/api/v1/webhooks/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
      body: JSON.stringify({ event, payload, occurredAt: occurredAt.toISOString(), eventId }),
      signal: AbortSignal.timeout(EventPublisherHttpAdapter.TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`admin-service responded ${res.status}`);
  }
}
