/** How many items wait in one queue, and since when the oldest of them has. */
export interface PendingSummary {
  count: number;
  /** When the oldest counted item was raised; null when nothing waits. */
  oldestAt: Date | null;
}

/** HD-11: courier cash deposits as the AI web's Command Center counts them for one person. */
export interface PendingApprovalsReader {
  /**
   * SUBMITTED settlements. `depotIds` undefined is every depot; a list holds the count to those.
   * One with a shortfall charge raised waits for a second signature, so it is counted only when
   * `chargeApprover` is given (an account that may sign it), and then not if they raised it.
   */
  settlements(
    depotIds: readonly string[] | undefined,
    chargeApprover: string | null,
  ): Promise<PendingSummary>;
}
