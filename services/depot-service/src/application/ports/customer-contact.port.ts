/** What is needed to address one message to one customer. */
export interface CustomerContact {
  name: string;
  phone: string;
}

/**
 * Resolves one customer's display name and phone from customer-service, by id.
 *
 * Fails OPEN to `null`: a customer with no number on file is simply not reachable, and the
 * sweep counts them as skipped rather than aborting the round.
 */
export interface CustomerContactPort {
  resolve(customerId: string): Promise<CustomerContact | null>;
}
