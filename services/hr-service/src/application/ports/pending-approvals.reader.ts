export const PENDING_APPROVALS_READER = Symbol('PENDING_APPROVALS_READER');

/** How many items wait in one queue, and since when the oldest of them has. */
export interface PendingSummary {
  count: number;
  /** When the oldest counted item was raised; null when nothing waits. */
  oldestAt: Date | null;
}

export interface LeavePendingFilter {
  /** The stage the asker decides. */
  status: 'PENDING_MANAGER' | 'PENDING_HR';
  /** Undefined: every depot. A list holds the count to those depots. */
  depotIds: readonly string[] | undefined;
  /** The asker's own employee record, if they have one: nobody decides their own leave. */
  notEmployeeId: string | null;
  /** Stage 2: not the applications the asker signed at stage 1 (CA-1-40). */
  notManagerDecidedBy: string | null;
}

/** HD-11: leave applications as the AI web's Command Center counts them for one person. */
export interface PendingApprovalsReader {
  leave(filter: LeavePendingFilter): Promise<PendingSummary>;
}
