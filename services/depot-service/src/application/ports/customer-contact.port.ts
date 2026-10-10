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
  /**
   * The customer id behind a phone number, pre-registering a PENDING account when there is
   * none (the same door the counter sale and the customer import use). `null` when
   * customer-service cannot be asked: an import row must FAIL then, never guess a customer.
   */
  resolveByPhone?(
    phone: string,
    fullName?: string,
    depotId?: string,
  ): Promise<{ customerId: string; status: 'created' | 'pending' | 'active' } | null>;
}
