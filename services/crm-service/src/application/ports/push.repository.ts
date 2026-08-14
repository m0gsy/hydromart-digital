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
  /**
   * Remove a device endpoint. `customerId` scopes the delete to its owner: the HTTP
   * unsubscribe route takes the endpoint from the query string, so without it anyone
   * signed in could unregister anyone else's device. Omitted only by the internal prune
   * path, which is already holding the row it is deleting.
   */
  deleteByEndpoint(endpoint: string, customerId?: string): Promise<void>;
}
