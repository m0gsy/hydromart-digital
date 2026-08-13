/** A completed order handed to payout-service as franchise revenue (design 6a). */
export interface OrderRevenueEvent {
  orderId: string;
  orderNumber: string;
  franchiseOwnerId: string;
  depotId: string | null;
  /** Order total in whole IDR — what the owner is credited. */
  amountIdr: number;
  /**
   * Goods subtotal BEFORE discount — what payout-service charges the franchise commission on.
   *
   * The commission used to be taken off `amountIdr`, i.e. subtotal + ongkir − discount, so HQ
   * took a cut of the delivery fee (money the depot pays a courier, not margin) and gave up its
   * cut of every voucher HQ itself funded.
   */
  commissionBaseIdr: number;
  completedAt: string;
}

/**
 * Posts completed orders to the franchise owner's payout ledger. Fails OPEN: payout being
 * down must never block an order from completing, and the push is idempotent on the payout
 * side (keyed by order id), so a later retry cannot double-credit.
 */
export interface FranchiseRevenuePort {
  orderCompleted(event: OrderRevenueEvent): Promise<void>;
  /**
   * Backs the revenue and commission out again when a counter sale is reversed. Without it
   * the franchise owner keeps being credited for money that was handed back to the buyer.
   *
   * Fails OPEN like the push, and is idempotent on the payout side. No amount is sent: the
   * figures come off the original ledger rows, so a commission-scheme change since the sale
   * cannot alter what is reversed.
   */
  orderVoided(orderId: string, reason: string): Promise<void>;
}
