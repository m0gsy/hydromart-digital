/**
 * Answers "has this customer ever had an order reach COMPLETED?" — owned by order-service.
 *
 * Fails CLOSED, unlike every other port in this service. `null` means "could not ask", and
 * the caller must refuse the redemption rather than assume the answer. The first completed
 * order grants both rewards; a void reverses them, but an outage must not become an open
 * door for unqualified redemptions. Same rule as `OrderCoordinationPort` in payment-service.
 */
export interface OrderHistoryPort {
  hasCompletedOrder(customerId: string): Promise<boolean | null>;
  statusOfOrder(orderId: string): Promise<string | null>;
  /**
   * REF-03: a completed order of this customer, or null for none OR "could not ask". The
   * reconciliation sweep qualifies only on a real id, so an unanswerable question pays nobody.
   */
  completedOrderId(customerId: string): Promise<string | null>;
}
