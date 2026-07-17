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
export interface CourierPayoutPort {
  deliveryCompleted(event: DeliveryCompletedEvent): Promise<void>;
}
