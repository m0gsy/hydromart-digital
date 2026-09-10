/** The little a self-claim needs to know about an order it has not been handed. */
export interface ClaimableOrder {
  id: string;
  orderNumber: string;
  depotId: string | null;
  status: string;
  /** When the order last changed STATUS — not when the row was last written. */
  statusChangedAt: Date;
  recipientName: string;
  phone: string;
  addressLine: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  deliveryWindow: string | null;
  customerId: string;
  /** order-service's own shape; the claim maps it to the two fields a delivery carries. */
  items: { productName: string; quantity: number }[];
}

/**
 * Reads one order so a courier can claim it themselves.
 *
 * Carries the COURIER'S OWN bearer, not the internal key, and that is the depot gate rather
 * than an oversight: `GET /orders/manage/:id` is `@Can('orderQueue')` followed by
 * `assertDepotAccess(user, order.depotId)`, and STAFF_DEPOT is in `orderQueue`. So a
 * courier reading an order outside their own depot gets a 403 from order-service before
 * this service ever sees the row — one gate, in the place that already owns it, rather than
 * a second copy of the rule here that could drift from the first.
 *
 * A 403 therefore means "not your depot", NOT "you lost a race". They are reported apart.
 */
export interface OrderLookupPort {
  findForClaim(orderId: string, authorization: string): Promise<ClaimableOrder | null>;
}
