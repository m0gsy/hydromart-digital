/** The eight queues HD-11 counts, in the order the owner listed them (24 Nov 2026). */
export const PENDING_QUEUE_KEYS = [
  'priceOverrides',
  'refunds',
  'expenses',
  'settlements',
  'leave',
  'kasbon',
  'franchiseApplications',
  'approvals',
] as const;

export type PendingQueueKey = (typeof PENDING_QUEUE_KEYS)[number];

/** The person a count is for, as their verified token says. */
export interface PendingAsker {
  actorId: string;
  role: string;
  /** Undefined: the whole network. Never empty: an account with no depot is answered 0 here. */
  depotIds?: readonly string[];
}

export interface PendingCount {
  count: number;
  /** UTC ISO time the oldest counted item was raised; null when nothing waits. */
  oldestAt: string | null;
}

/** Each queue's count, from the service that holds it. */
export interface PendingApprovalSourcesPort {
  /** Rejects when that service cannot answer: not configured, unreachable, refused, malformed. */
  count(queue: PendingQueueKey, asker: PendingAsker): Promise<PendingCount>;
}
