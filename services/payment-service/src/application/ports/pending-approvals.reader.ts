/** How many items wait in one queue, and since when the oldest of them has. */
export interface PendingSummary {
  count: number;
  /** When the oldest counted item entered the queue; null when nothing waits. */
  oldestAt: Date | null;
}

/** HD-11: the refund queue as the AI web's Command Center counts it for one person. */
export interface PendingApprovalsReader {
  /**
   * Refunds parked above the HQ threshold (refundApproval PENDING), network-wide: the queue has
   * no depot. `notRequestedBy` leaves out the refunds that account raised (null: leave none out).
   */
  refunds(notRequestedBy: string | null): Promise<PendingSummary>;
}
