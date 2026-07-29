/**
 * Retention enforcement (M23-21 follow-up). The policy table says what MAY be deleted;
 * an executor is the thing that actually deletes it, for exactly one dataset.
 *
 * Every dataset without an executor is reported as `UNENFORCED` rather than skipped in
 * silence. A retention policy nobody enforces is the dangerous case: the console shows a
 * window, the auditor believes it, and nothing has ever been deleted. Naming the gap is
 * the whole point of this registry.
 */
export interface PurgeExecutor {
  /** Must match `retention_policies.dataset` exactly. */
  readonly dataset: string;
  /** Delete records strictly older than `cutoff`; returns how many went. */
  purge(cutoff: Date): Promise<number>;
}

export const PURGE_EXECUTORS = Symbol('PurgeExecutors');
