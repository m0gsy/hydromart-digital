/**
 * Answers "has this customer ever had an order reach COMPLETED?" — owned by order-service.
 *
 * Fails CLOSED, unlike every other port in this service. `null` means "could not ask", and
 * the caller must refuse the redemption rather than assume the answer. Redeeming pays 500
 * points to the referrer and 250 to the referee the moment their first order completes, and
 * there is no way to take them back; an outage must not become an open door for its
 * duration. Same rule, same wording, as `OrderCoordinationPort` in payment-service.
 */
export interface OrderHistoryPort {
  hasCompletedOrder(customerId: string): Promise<boolean | null>;
}
