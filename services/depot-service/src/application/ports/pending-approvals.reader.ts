/** How many items wait in one queue, and since when the oldest of them has. */
export interface PendingSummary {
  count: number;
  /** When the oldest counted item was raised; null when nothing waits. */
  oldestAt: Date | null;
}

/**
 * HD-11: the three depot-service queues the AI web's Command Center counts for one person.
 * `depotIds` undefined is the whole network (a caller who sees every depot); a list holds the
 * count to exactly those depots.
 */
export interface PendingApprovalsReader {
  /** Price changes a depot proposed, still PENDING. */
  priceOverrides(depotIds: readonly string[] | undefined): Promise<PendingSummary>;
  /** Franchise applications not yet approved or rejected. No depot: an application has none. */
  franchiseApplications(): Promise<PendingSummary>;
  /** Depot approval items PENDING or HELD, leaving out the ones `notSubmittedBy` raised. */
  approvals(
    depotIds: readonly string[] | undefined,
    notSubmittedBy: string,
  ): Promise<PendingSummary>;
}
