/** The contact fields needed to address a notification, resolved from customer-service. */
export interface CustomerContact {
  name: string;
  phone: string;
}

/**
 * Resolves one customer's display name + phone (from customer-service). Used to address
 * the "voucher baru" notification. Fails OPEN: returns null when unresolved so a grant
 * still succeeds without a notification.
 */
export interface CustomerLookupPort {
  resolve(customerId: string, authorization: string): Promise<CustomerContact | null>;
}
