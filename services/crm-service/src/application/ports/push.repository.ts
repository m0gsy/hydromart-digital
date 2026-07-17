export interface WebPushSubscriptionRecord {
  id: string;
  customerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SaveSubscriptionData {
  customerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRepository {
  /** Register (or re-point) a device endpoint to a customer. Idempotent by endpoint. */
  upsert(data: SaveSubscriptionData): Promise<WebPushSubscriptionRecord>;
  listForCustomer(customerId: string): Promise<WebPushSubscriptionRecord[]>;
  deleteByEndpoint(endpoint: string): Promise<void>;
}
