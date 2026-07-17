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
}

export interface WebhookRepository {
  list(): Promise<WebhookRecord[]>;
  create(data: CreateWebhookData): Promise<WebhookRecord>;
  update(id: string, data: UpdateWebhookData): Promise<WebhookRecord | null>;
  /** Returns true when a row was deleted, false when the id was unknown. */
  remove(id: string): Promise<boolean>;
}
