export const OPEN_ORDERS_PORT = Symbol('OPEN_ORDERS_PORT');

/**
 * How many orders a customer still has in flight, asked of order-service before an account
 * is erased.
 *
 * Fails CLOSED: an unreachable order-service is not "zero orders". Erasing the identity
 * behind a delivery that is on its way is irreversible, whereas a refused approval is one
 * click to retry.
 */
export interface OpenOrdersPort {
  countOpen(customerId: string): Promise<number>;
}
