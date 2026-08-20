export const CASHIER_SHIFT_PORT = Symbol('CASHIER_SHIFT_PORT');

/**
 * C2: which drawer is open at this depot right now, for the person ringing up the sale.
 *
 * Asked SERVER-side, from the cashier's own token, and never taken from the request body.
 * The drawer a payment lands in decides who is short at close — a client that could name
 * the shift could name somebody else's, and the whole point of the column is that the
 * money is answerable to a named person.
 *
 * Returns null when there is no open shift, when depot-service is unreachable, or when
 * there is no token to ask with. Null means "unattributed", not "refused": the payment is
 * still created. Refusing here would be a new uptime dependency on the till, and
 * order-service already fails the SALE closed if no shift is open — by the time a payment
 * is being initiated the goods have left the shelf, and losing the payment record over a
 * depot-service blip is strictly worse than a payment the window rule still attributes.
 */
export interface CashierShiftPort {
  openShiftId(depotId: string, authorization: string): Promise<string | null>;
}
