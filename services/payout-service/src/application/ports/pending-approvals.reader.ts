/** How many items wait in one queue, and since when the oldest of them has. */
export interface PendingSummary {
  count: number;
  /** When the oldest counted item was raised; null when nothing waits. */
  oldestAt: Date | null;
}

/** HD-11: courier expense claims as the AI web's Command Center counts them for one person. */
export interface PendingApprovalsReader {
  /**
   * PENDING claims. `depotIds` undefined is every depot (claims with no depot included, as the
   * review queue shows them to a network-wide reviewer); a list holds the count to those depots.
   */
  expenses(depotIds: readonly string[] | undefined): Promise<PendingSummary>;
}
