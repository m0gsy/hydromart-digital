/** The last tick of one scheduled sweep, as `sweep.sh` reported it (CA-5-01). */
export interface SweepRunRecord {
  job: string;
  host: string;
  lastRunAt: Date;
  ok: boolean;
  detail: string | null;
  /**
   * Last run that actually WORKED. Separate from `lastRunAt` because "ran" and "worked" are
   * different claims — collapsing them is how a job failing every tick reads as healthy.
   */
  lastOkAt: Date | null;
  consecutiveFailures: number;
}

/** What one heartbeat carries. */
export interface RecordSweepRun {
  job: string;
  host: string;
  ok: boolean;
  detail: string | null;
  at: Date;
}

export interface SweepRunRepository {
  /**
   * Upsert one job's row. Deliberately not an append: the question this table answers is
   * "is this sweep alive", which the last run answers on its own, and one row per job keeps
   * it at seventeen rows forever — no purge job, no retention class, no personal data.
   *
   * `lastOkAt` and `consecutiveFailures` are advanced HERE rather than by the caller, so a
   * scheduler that reports the same round twice cannot corrupt the streak.
   */
  record(run: RecordSweepRun): Promise<SweepRunRecord>;
  /** Every row. Seventeen at most, so it is deliberately unpaged and unfiltered. */
  list(): Promise<SweepRunRecord[]>;
}
