/** A completed delivery, pushed to payout-service to credit the courier's earnings. */
export interface DeliveryCompletedEvent {
  courierId: string;
  depotId: string | null;
  deliveryId: string;
  deliveredAt: string;
  onTime: boolean;
}

/**
 * Reports a completed delivery to payout-service so it can credit the courier's
 * earnings ledger. The earning amount is computed there (the rate policy has one
 * home). At-least-once + idempotent by deliveryId, so this fails OPEN — a delivery
 * must never fail because its earning push did.
 */
/** A COD deposit shortfall charged to a courier at settlement verify (design 2d). */
export interface CashVarianceChargedEvent {
  courierId: string;
  depotId: string | null;
  settlementId: string;
  /** Positive shortfall magnitude (IDR); payout posts it as a debit. */
  amount: number;
}

export interface CourierPayoutPort {
  deliveryCompleted(event: DeliveryCompletedEvent): Promise<void>;
  /**
   * Charges a courier for a COD deposit shortfall. At-least-once + idempotent by
   * settlementId; fails OPEN — the settlement already records the charge, so a lost
   * push never blocks verify (a reconcile can replay it).
   */
  cashVarianceCharged(event: CashVarianceChargedEvent): Promise<void>;
}
