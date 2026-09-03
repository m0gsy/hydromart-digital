/**
 * Asking for the customer's money back when a dispute is resolved as REFUND.
 *
 * CA-2-39: `resolve()` wrote the dispute row and nothing else. A manager choosing REFUND
 * believed the customer would be repaid; nothing repaid them, and the only record was a
 * status on a queue nobody reconciles against the money.
 *
 * **This QUEUES a refund, it does not pay one.** payment-service already has the path — a
 * requested refund waits for HQ approval and settles there (`payment.refund.requested` →
 * `approved` → `settled`). Putting the dispute into that queue is the honest wiring: the
 * decision a depot manager is allowed to make is "this customer should be refunded", and
 * the decision HQ is allowed to make is "and here is the money".
 *
 * The caller's own token travels with it, so `Can('refundIssue')` applies to the manager
 * who pressed the button and the refund is attributed to them. A manager without that
 * capability is refused — which is right, and is not something depot-service should decide
 * for itself with an internal key.
 */
export interface DisputeRefundPort {
  /**
   * Queue a refund for the order behind a dispute.
   *
   * @param orderRef the human order number the operator typed when raising the dispute
   * @throws when the order cannot be found, has no payment, or the refund is refused —
   *   the caller must not record a resolution it could not carry out.
   */
  request(orderRef: string, reason: string, authorization: string): Promise<void>;
}
