/**
 * Port for notifying a newly-registered customer (welcome message). Fired after
 * successful phone verification. The concrete adapter calls crm-service over the
 * internal service-auth path; it MUST fail open so a notification outage never
 * blocks registration.
 */
export interface CustomerNotificationPort {
  sendWelcome(phone: string, name: string): Promise<void>;
}
