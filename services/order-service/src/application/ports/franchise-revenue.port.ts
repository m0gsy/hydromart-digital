/** A completed order handed to payout-service as franchise revenue (design 6a). */
export interface OrderRevenueEvent {
  orderId: string;
  orderNumber: string;
  franchiseOwnerId: string;
  depotId: string | null;
  /** Order total in whole IDR. */
  amountIdr: number;
  completedAt: string;
}

/**
 * Posts completed orders to the franchise owner's payout ledger. Fails OPEN: payout being
 * down must never block an order from completing, and the push is idempotent on the payout
 * side (keyed by order id), so a later retry cannot double-credit.
 */
export interface FranchiseRevenuePort {
  orderCompleted(event: OrderRevenueEvent): Promise<void>;
}
