/**
 * Suspending the account behind a fraud flag.
 *
 * CA-2-05: the fraud queue's "Blokir" button only ever set the FLAG's own status. An
 * operator pressed it, the row turned red, and the customer kept ordering — the queue
 * recorded a decision that nothing carried out.
 *
 * auth-service owns the account and already refuses a SUSPENDED one at sign-in
 * (`Customer.ensureCanAuthenticate`), so the block is real at the only door that matters.
 * This port is how admin-service asks for it.
 *
 * **Fails CLOSED, unlike most of this service's outbound calls.** A flag that reads BLOCKED
 * while the account still signs in is the exact bug being fixed, so an unreachable
 * auth-service must leave the flag OPEN and say so, not move it and hope.
 */
export interface AccountSuspensionPort {
  /**
   * Suspend or reinstate an end customer.
   *
   * @throws when the account could not be reached or changed — the caller must not record
   *   a decision it could not carry out.
   */
  setActive(customerId: string, active: boolean): Promise<void>;
}
