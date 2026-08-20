import { Injectable, Logger } from '@nestjs/common';

import { OrderConfigService } from '../../config/order-config.service';
import { GallonIssueEvent, GallonIssuePort } from '../../application/ports/gallon-issue.port';

/**
 * Books a completed delivery's empties into depot-service's gallon-issue ledger (I1),
 * keyed by the shared INTERNAL_SERVICE_KEY (the gateway strips that header inbound, so it
 * only ever travels service-to-service).
 *
 * Fails CLOSED, unlike its neighbours here. It runs from the completion outbox, and the
 * outbox exists precisely so an effect that moves money is retried rather than lost: a
 * deposit the depot holds in fact but not in its book makes the next courier return refund
 * Rp0 and queue a manager approval. The one thing it will not do is retry forever against
 * a deployment that has no depot integration at all — a blank URL or key is a
 * configuration fact, not an outage, so that skips.
 */
@Injectable()
export class GallonIssueHttpAdapter implements GallonIssuePort {
  private static readonly TIMEOUT_MS = 5000;
  private readonly logger = new Logger(GallonIssueHttpAdapter.name);

  constructor(private readonly config: OrderConfigService) {}

  async orderDelivered(event: GallonIssueEvent): Promise<void> {
    const { depotServiceUrl, internalServiceKey } = this.config;
    if (!depotServiceUrl || !internalServiceKey) {
      this.logger.debug(`Gallon issue skipped (depot integration disabled): ${event.orderId}`);
      return;
    }
    // `AbortSignal.timeout` rather than an AbortController and a setTimeout: the manual
    // pair leaves behind a `() => controller.abort()` callback that no test ever runs, and
    // chasing that with a test proves nothing about the timeout. This has no callback to
    // leave uncovered, and no `finally` to remember to clear.
    const res = await fetch(
      `${depotServiceUrl}/api/v1/depots/${event.depotId}/gallon-issues/internal/from-order`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-key': internalServiceKey },
        body: JSON.stringify({
          orderId: event.orderId,
          customerId: event.customerId ?? undefined,
          quantity: event.quantity,
        }),
        signal: AbortSignal.timeout(GallonIssueHttpAdapter.TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      throw new Error(`depot-service responded ${res.status}`);
    }
  }
}
