/** One approval queue as dashboard-service answers it for a person (HD-11). */
export interface PendingQueueAnswer {
  key: string;
  /** Null only with `error`: the queue could not be read, which is not zero. */
  count: number | null;
  oldestAt: string | null;
  /** The hydromart web path where the person acts on it. */
  href: string;
  error?: 'unavailable';
}

/**
 * AI-9: the HD-11 answer for one account, asked of dashboard-service (the queue rules live
 * there, crm holds none of them). THROWS when dashboard-service does not answer.
 */
export interface PendingApprovalsPort {
  forAccount(accountId: string, role: string): Promise<PendingQueueAnswer[]>;
}
