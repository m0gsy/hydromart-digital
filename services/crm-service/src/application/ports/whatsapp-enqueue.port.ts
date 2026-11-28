/** What `notifyOnce` hands to the WhatsApp send path after the inbox row and the push have been filed. */
export interface WhatsappEnqueuePort {
  /** Never throws: WhatsApp is additive and must not cost a notification. */
  enqueue(input: {
    event: string;
    customerId: string;
    notificationId: string;
    dedupeKey: string | null;
    vars: Record<string, string>;
  }): Promise<void>;
  /**
   * auth-service told us a customer's login number changed: the OLD number's consent ends, so nothing is
   * silently redirected to a number that never agreed. Never throws.
   */
  phoneChanged(oldPhone: string): Promise<void>;
}
