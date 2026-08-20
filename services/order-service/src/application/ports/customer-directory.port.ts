/**
 * The one thing order-service tells customer-service about a customer: where they bought.
 *
 * §I. A depot's customer directory reads `customer_profiles.favoriteDepotId`, and that
 * column was written by exactly two things — the depot's Excel import and a `PATCH /profile`
 * the console never calls. So somebody who registered themselves and ordered ten times from
 * one depot did not appear in that depot's directory at all. Checkout is the moment the
 * relationship actually exists, and this is where it gets recorded.
 *
 * Fails OPEN, and the far side only writes when there is no favourite yet: the order has
 * already been placed and paid for, and a directory entry is not worth unwinding it over.
 */
export interface CustomerDirectoryPort {
  /**
   * Record `depotId` as this customer's depot when they have none.
   *
   * Resolves to `true` only when it wrote. Never throws — a failure is logged and the
   * checkout carries on.
   */
  claimFavoriteDepot(customerId: string, depotId: string): Promise<boolean>;

  /**
   * §I: the counter buyer, resolved (or pre-registered) from the phone the cashier typed.
   *
   * Resolution used to happen in the POS page's browser — it posted a one-row Excel import
   * and sent the id back — so any other client posting `/orders/walk-in` with a phone and
   * no customerId booked the sale against the anonymous sentinel and created nobody.
   *
   * Never throws: an unresolved buyer comes back as `null` and the CALLER decides what
   * that means. It is the one counter call whose caller fails closed — see
   * `CounterBuyerUnresolvedError` for why booking the sale anonymously instead would let a
   * retry sell the same goods twice.
   */
  /**
   * C9: `fullName` is nullable because a cashier who typed only a phone number has NOT
   * named anybody. It used to fall back to the phone, so the account was created with a
   * phone number standing in as a person's name.
   */
  resolveByPhone(phone: string, fullName: string | null, depotId: string): Promise<string | null>;
}
