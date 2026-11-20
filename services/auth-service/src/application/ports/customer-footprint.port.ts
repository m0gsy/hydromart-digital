export const CUSTOMER_FOOTPRINT_PORT = Symbol('CUSTOMER_FOOTPRINT_PORT');

/**
 * Was this customer account ever used: an order of any status, a subscription, or a point.
 *
 * Asked before HR's phone correction closes the customer account that sits on a staff
 * member's real number. Fails CLOSED like `OpenOrdersPort`: an unreachable peer is not
 * "unused" — closing an account cannot be undone, and a refused HR edit is a retry.
 */
export interface CustomerFootprintPort {
  isUnused(customerId: string): Promise<boolean>;
}
