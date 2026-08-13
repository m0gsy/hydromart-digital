/** PAID cash recorded against one order (IDR, whole rupiah). */
export interface OrderCashRow {
  orderId: string;
  amountIdr: number;
}

/**
 * The cash side of a depot's day, read from payment-service.
 *
 * Two buckets, never one. A payment row carries `depotId` ONLY for a counter sale — a
 * delivery order's payment is booked against the order, not the depot — so "cash the
 * courier brought back" and "cash in the till" have to be asked for separately. Adding
 * them into a single figure counts a walk-in twice and hides exactly the variance the
 * daily report exists to surface.
 *
 * Every method returns `null` when payment-service is unreachable or the internal key is
 * unset. Null is not 0: one means nobody paid, the other means somebody may be holding
 * money nobody has counted.
 */
export interface PaymentCashPort {
  /** PAID cash per order, for the given order ids. Orders with no cash payment are absent. */
  cashByOrder(orderIds: string[]): Promise<OrderCashRow[] | null>;
  /** PAID counter cash booked against the depot in [from, to). */
  depotCash(depotId: string, from: Date, to: Date): Promise<number | null>;
}
