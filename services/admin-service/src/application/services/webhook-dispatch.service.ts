import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  MAX_ATTEMPTS,
  nextAttemptDelayMs,
  signPayload,
  successRatePct,
} from '../../domain/webhook-delivery';
import {
  DueDelivery,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookRepository,
} from '../ports/webhook.repository';
import { ADMIN_TOKENS } from '../tokens';

/** How many deliveries one sweep sends, and how long a claim is held. */
const BATCH = 50;
const LEASE_MS = 5 * 60_000;
const SEND_TIMEOUT_MS = 10_000;

export interface PublishEventInput {
  event: string;
  payload: unknown;
  occurredAt?: Date;
}

/**
 * H-30: the machinery that makes a webhook subscription mean something.
 *
 * A service reports an event once; this queues one delivery per subscribed endpoint and
 * the scheduler sweep drains them. Signed (HMAC over `<timestamp>.<body>`), retried with
 * backoff, abandoned as DEAD after MAX_ATTEMPTS, and the endpoint's success rate is
 * recomputed from what actually happened — the two columns that used to be permanently
 * null because nothing ever dispatched.
 */
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);

  constructor(
    @Inject(ADMIN_TOKENS.WebhookDeliveryRepository)
    private readonly deliveries: WebhookDeliveryRepository,
    @Inject(ADMIN_TOKENS.WebhookRepository) private readonly endpoints: WebhookRepository,
  ) {}

  /** Fan one event out to every active subscriber. Returns how many were queued. */
  async publish(input: PublishEventInput, now = new Date()): Promise<{ queued: number }> {
    const subscribers = await this.deliveries.subscribersOf(input.event);
    const occurredAt = input.occurredAt ?? now;
    const queued = await this.deliveries.queue(
      subscribers.map((s) => ({
        endpointId: s.id,
        event: input.event,
        payload: input.payload,
        occurredAt,
      })),
    );
    if (queued > 0) this.logger.log(`Queued ${input.event} for ${queued} endpoint(s)`);
    return { queued };
  }

  /** Send every due delivery. Driven by the scheduler; safe to run concurrently. */
  async process(now = new Date()): Promise<{ sent: number; failed: number; dead: number }> {
    const due = await this.deliveries.claimDue(now, BATCH, LEASE_MS);
    let sent = 0;
    let failed = 0;
    let dead = 0;
    const touched = new Set<string>();

    for (const delivery of due) {
      touched.add(delivery.endpointId);
      const outcome = await this.attempt(delivery, now);
      if (outcome === 'sent') sent += 1;
      else if (outcome === 'dead') dead += 1;
      else failed += 1;
    }

    for (const endpointId of touched) await this.refreshStats(endpointId);
    return { sent, failed, dead };
  }

  /** Re-queue one delivery (partner API / HQ). 404 when the id is unknown. */
  async replay(id: string, now = new Date()): Promise<WebhookDeliveryRecord> {
    const row = await this.deliveries.replay(id, now);
    if (!row) throw new NotFoundException('Delivery not found');
    return row;
  }

  list(limit: number, event?: string): Promise<WebhookDeliveryRecord[]> {
    return this.deliveries.listForPartner(limit, event);
  }

  private async attempt(delivery: DueDelivery, now: Date): Promise<'sent' | 'failed' | 'dead'> {
    const attempts = delivery.attempts + 1;
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      occurredAt: delivery.occurredAt.toISOString(),
      data: delivery.payload,
    });
    const timestamp = String(Math.floor(now.getTime() / 1000));
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Hydromart-Event': delivery.event,
      'X-Hydromart-Delivery': delivery.id,
      'X-Hydromart-Timestamp': timestamp,
    };
    // No secret means the receiver cannot tell our POST from anyone else's. Still sent —
    // an endpoint registered without one asked for that — but it is not signed with a
    // placeholder, which would look like authentication and be none.
    if (delivery.secret) {
      headers['X-Hydromart-Signature'] = signPayload(delivery.secret, timestamp, body);
    }

    let status: number | null = null;
    let error: string | null = null;
    try {
      const response = await fetch(delivery.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      status = response.status;
      if (!response.ok) error = `endpoint responded ${response.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (!error) {
      await this.deliveries.markDelivered(delivery.id, status ?? 200, now);
      return 'sent';
    }
    if (attempts >= MAX_ATTEMPTS) {
      this.logger.error(
        `Webhook ${delivery.event} to ${delivery.url} abandoned after ${attempts} attempts: ${error}`,
      );
      await this.deliveries.markDead(delivery.id, attempts, error, status);
      return 'dead';
    }
    const next = new Date(now.getTime() + nextAttemptDelayMs(attempts));
    await this.deliveries.markRetry(delivery.id, attempts, next, error, status);
    return 'failed';
  }

  /** Recompute the endpoint's advertised outcome + success rate from its real deliveries. */
  private async refreshStats(endpointId: string): Promise<void> {
    const { delivered, attempted, lastStatus } = await this.deliveries.endpointStats(endpointId);
    await this.endpoints.update(endpointId, {
      lastDeliveryStatus: lastStatus,
      deliveryRatePct: successRatePct(delivered, attempted),
    });
  }
}
