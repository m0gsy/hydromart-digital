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

/** What payout-service actually paid one courier at one depot over a window (E-1). */
export interface CourierPaidEarnings {
  courierId: string;
  earnedIdr: number;
  /** EARNING entries behind `earnedIdr` — what the payer counted as a delivery. */
  paidDeliveries: number;
}

export interface CourierPayoutPort {
  deliveryCompleted(event: DeliveryCompletedEvent): Promise<void>;
  /**
   * Reads what payout-service paid each courier at a depot over a window, for the depot's
   * commission report.
   *
   * Fails to NULL, deliberately, and the caller must NOT substitute a rate of its own. The
   * commission report used to compute `delivered × courierRatePerDeliveryIdr` from a flat
   * rate configured here — in the service that does not pay — so the manager's report and
   * the courier's ledger stated different amounts for the same deliveries. A fallback rate
   * is precisely how the second number was born; an unavailable answer says so instead.
   */
  paidEarnings(depotId: string, from: Date, to: Date): Promise<CourierPaidEarnings[] | null>;
  /**
   * Charges a courier for a COD deposit shortfall. At-least-once + idempotent by
   * settlementId.
   *
   * CA-2-32: answers whether the debit actually landed, and the caller REFUSES the verify
   * when it did not. This used to fail open behind `void` — the settlement was written
   * `chargedToDriver: true` first and the push was fired at nothing, so an unreachable
   * payout-service produced a settlement that said a courier had been charged and a wage
   * ledger that had never heard of it. Nobody was looking for the difference, because the
   * only record of the charge said it was made.
   */
  cashVarianceCharged(event: CashVarianceChargedEvent): Promise<boolean>;
}
