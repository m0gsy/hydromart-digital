export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  secret: string | null;
  lastDeliveryStatus: string | null;
  deliveryRatePct: number | null;
  createdAt: Date;
}

export interface CreateWebhookData {
  url: string;
  events: string[];
  active?: boolean;
  secret?: string | null;
}

/** Fields a PATCH may change on a webhook (all optional; at least one supplied). */
export interface UpdateWebhookData {
  url?: string;
  events?: string[];
  active?: boolean;
  secret?: string | null;
  /** Written by the dispatcher only — never exposed on the PATCH DTO. */
  lastDeliveryStatus?: string | null;
  deliveryRatePct?: number | null;
}

export interface WebhookRepository {
  list(): Promise<WebhookRecord[]>;
  create(data: CreateWebhookData): Promise<WebhookRecord>;
  update(id: string, data: UpdateWebhookData): Promise<WebhookRecord | null>;
  /** Returns true when a row was deleted, false when the id was unknown. */
  remove(id: string): Promise<boolean>;
}

/* ---------- Deliveries (H-30) ---------- */

export type WebhookDeliveryStatus = 'PENDING' | 'DELIVERED' | 'FAILED' | 'DEAD';

export interface WebhookDeliveryRecord {
  id: string;
  endpointId: string;
  event: string;
  payload: unknown;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAt: Date;
  responseStatus: number | null;
  lastError: string | null;
  occurredAt: Date;
  deliveredAt: Date | null;
  createdAt: Date;
}

/** A due delivery with the endpoint it is owed to, so the sender needs no second read. */
export interface DueDelivery extends WebhookDeliveryRecord {
  url: string;
  secret: string | null;
}

export interface WebhookDeliveryRepository {
  /** Endpoints that are active AND subscribed to this event. */
  subscribersOf(event: string): Promise<WebhookRecord[]>;
  queue(
    rows: { endpointId: string; event: string; payload: unknown; occurredAt: Date }[],
  ): Promise<number>;
  /**
   * PENDING rows whose next attempt is due, oldest first. Each is claimed by moving its
   * next attempt out of reach first, so two overlapping sweeps cannot both send it.
   */
  claimDue(now: Date, limit: number, leaseMs: number): Promise<DueDelivery[]>;
  markDelivered(id: string, responseStatus: number, at: Date): Promise<void>;
  /** Failed but retryable: bump attempts, schedule the next try, record why. */
  markRetry(
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    error: string,
    responseStatus: number | null,
  ): Promise<void>;
  /** Out of attempts. Stays in the table as the record of what was never delivered. */
  markDead(id: string, attempts: number, error: string, responseStatus: number | null): Promise<void>;
  /** Delivered vs attempted for one endpoint, plus its most recent outcome. */
  endpointStats(
    endpointId: string,
  ): Promise<{ delivered: number; attempted: number; lastStatus: WebhookDeliveryStatus | null }>;
  /** Newest-first delivery history, for the partner API. */
  listForPartner(limit: number, event?: string): Promise<WebhookDeliveryRecord[]>;
  /** Re-queue one delivery for another attempt. Null when the id is unknown. */
  replay(id: string, at: Date): Promise<WebhookDeliveryRecord | null>;
}
