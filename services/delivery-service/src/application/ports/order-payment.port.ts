/** An order's payment as payment-service knows it. `amount` is what was charged. */
export interface OrderPaymentSnapshot {
  method: string;
  amount: number;
  /**
   * Where the money actually is: PENDING | PAID | FAILED | REFUNDED | ...
   *
   * CA-4-03. `method` and `amount` together answer "should the courier collect cash", which
   * is all `assign` ever needed. They cannot answer "HAS the courier collected it" — and
   * that is the question every path after the door depends on. A delivery marked Gagal or
   * Jadwal-ulang while its cash payment is already PAID leaves a courier holding real money
   * against an order that no longer counts as delivered.
   *
   * The console used to ask payment-service this itself, from the courier's own token, and
   * swallowed the answer on failure (`.catch(() => false)`) — so a 403, a 429 or a lost
   * signal all rendered as "cash already taken". Reading it here removes the guess: the
   * internal key never 403s, and an unreachable payment-service throws instead of
   * answering.
   */
  status: string;
}

/**
 * Reads the order's payment so THIS service decides whether the courier collects on
 * delivery — the console used to decide, and it could not.
 *
 * Assignment is guarded by `tracking` (KEPALA_DEPOT, MANAGER, SUPERVISOR,
 * ASSISTANT_SUPERVISOR, SUPER_ADMIN) while the staff payment read is guarded by
 * `paymentSettle` (KEPALA_DEPOT, MANAGER, STAFF_DEPOT, FINANCE, SUPER_ADMIN). The two
 * supervisor roles are in the first list and not the second, so their payment read was a
 * 403 on EVERY dispatch — and the client turned that into "not a cash order", which sends
 * the courier out collecting nothing. Reading it here removes the client from the decision
 * altogether, along with every other way that read could fail (429, expired token, a phone
 * that lost signal between the two requests).
 *
 * Returns null when the order genuinely has no payment row. THROWS when payment-service
 * cannot answer: COD is money, and a guess is the one answer that must not ship.
 */
export interface OrderPaymentPort {
  forOrder(orderId: string): Promise<OrderPaymentSnapshot | null>;
  /**
   * The courier handed the cash back at the door — reverse the payment (CA-4-03).
   *
   * Owner decision D1, 2 September 2026: a delivery marked Gagal or Jadwal-ulang asks the
   * courier whether they returned the money. "Yes" lands here. There is deliberately NO
   * flag on the delivery row recording it: the payment book already models "collected and
   * then given back", and a REFUNDED payment drops out of `cash-collected` on its own — so
   * the end-of-shift deposit stops asking for it without the settlement needing a special
   * case, and the reversal is written where the rest of the money history lives.
   *
   * Reverses immediately with no approval queue, like a counter void: the customer already
   * has the notes in their hand, and parking that for a human to approve would mean the
   * system believes it holds money that physically walked away.
   *
   * Only ever called for a payment this service has just read as CASH + PAID. Fails CLOSED
   * — a throw leaves the payment PAID, which charges the money to the courier's deposit.
   * That is the safe direction: the money is then merely in the wrong pocket and visible,
   * rather than written off and gone.
   */
  reverseCash(orderId: string, reason: string, changedBy: string): Promise<void>;
}
