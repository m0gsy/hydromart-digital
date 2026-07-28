/**
 * UU PDP tahap 1 (item 13). auth-service owns the request queue and the account
 * identity; this port covers the PII customer-service holds on its own — the profile,
 * the delivery addresses (each with its own recipient name and phone), saved payment
 * labels, favourites and notification preferences.
 */
export interface PdpRepository {
  /** Everything this service holds for the customer, ready to hand over as JSON. */
  exportFor(customerId: string): Promise<Record<string, unknown>>;
  /**
   * Destroy the identifiers. Idempotent: running it twice must not fail, because
   * auth-service may retry after a timeout that actually succeeded.
   */
  anonymise(customerId: string): Promise<void>;
}
