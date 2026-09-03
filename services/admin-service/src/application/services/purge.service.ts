import { Inject, Injectable, Logger } from '@nestjs/common';

import { DataClass } from '../../domain/retention';
import { PURGE_EXECUTORS, PurgeExecutor } from '../ports/purge-executor.port';
import { RetentionService } from './retention.service';

export type PurgeOutcome =
  'PURGED' | 'REPORT_ONLY' | 'EXEMPT' | 'NOT_DUE' | 'UNENFORCED' | 'FAILED';

export interface PurgeResultEntry {
  dataset: string;
  dataClass: DataClass;
  outcome: PurgeOutcome;
  cutoff: string | null;
  /** Rows actually deleted (0 for every outcome except PURGED). */
  deleted: number;
  /**
   * Rows past their window on a REPORT_ONLY dataset — what a human would be deleting if
   * they acted on this. Absent for every other outcome, so it is never read as a count
   * of something that happened.
   */
  eligible?: number;
  /** Why an executor failed — surfaced, never swallowed. */
  error?: string;
}

export interface PurgeRunResult {
  ranAt: string;
  dryRun: boolean;
  entries: PurgeResultEntry[];
  totalDeleted: number;
  /** Datasets with a live policy and no executor — the honest compliance gap. */
  unenforced: string[];
  /** REPORT-only datasets that currently have rows past their window. */
  awaitingReview: string[];
  /**
   * J7: false when every dataset this run touched threw.
   *
   * A per-dataset catch keeps one failure from aborting the rest, which also meant a run
   * where all of them failed still answered HTTP 200 with a well-formed body, and
   * `sweep.sh` wrote the scheduler heartbeat for it. `unenforced` is deliberately NOT part
   * of this verdict — a dataset with a policy and no executor is a standing compliance gap
   * this sweep reports every night, not a failure of the night it ran.
   */
  ok: boolean;
}

/**
 * Executes the retention policy (M23-21 follow-up).
 *
 * Until now retention was a written policy with nothing behind it: the console showed a
 * window, and no row was ever deleted. This runs the policy for the datasets that have
 * an executor and reports the rest as UNENFORCED, so the gap is visible in the result
 * instead of being mistaken for success.
 *
 * FINANCIAL never runs — `purgeCutoffs` returns a null cutoff for it and a null cutoff is
 * treated as "nothing eligible", never as "delete everything". That inversion is the one
 * bug that would be unrecoverable, so it is decided in the pure domain module and only
 * read here.
 */
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly retention: RetentionService,
    @Inject(PURGE_EXECUTORS) private readonly executors: PurgeExecutor[],
  ) {}

  async run(options: { dryRun?: boolean; now?: Date } = {}): Promise<PurgeRunResult> {
    const dryRun = options.dryRun ?? false;
    const now = options.now ?? new Date();
    const plan = await this.retention.purgeCutoffs(now);
    const byDataset = new Map(this.executors.map((e) => [e.dataset, e]));

    const entries: PurgeResultEntry[] = [];
    for (const item of plan) {
      const base = {
        dataset: item.dataset,
        dataClass: item.dataClass,
        cutoff: item.cutoff ? item.cutoff.toISOString() : null,
        deleted: 0,
      };

      if (item.purgeExempt) {
        entries.push({ ...base, outcome: 'EXEMPT' });
        continue;
      }
      if (item.cutoff === null) {
        // A non-positive window means "keep everything" — deliberately not "delete all".
        entries.push({ ...base, outcome: 'NOT_DUE' });
        continue;
      }

      const executor = byDataset.get(item.dataset);
      if (!executor) {
        entries.push({ ...base, outcome: 'UNENFORCED' });
        continue;
      }
      if (dryRun) {
        entries.push({ ...base, outcome: 'NOT_DUE' });
        continue;
      }

      try {
        const affected = await executor.purge(item.cutoff);
        entries.push(
          executor.mode === 'REPORT'
            ? { ...base, outcome: 'REPORT_ONLY', eligible: affected }
            : { ...base, outcome: 'PURGED', deleted: affected },
        );
      } catch (error) {
        // One dataset failing must not abort the sweep — the others are independent.
        const message = (error as Error).message;
        this.logger.error(`Purge failed for ${item.dataset}: ${message}`);
        entries.push({ ...base, outcome: 'FAILED', error: message });
      }
    }

    const result: PurgeRunResult = {
      ranAt: now.toISOString(),
      dryRun,
      entries,
      totalDeleted: entries.reduce((sum, e) => sum + e.deleted, 0),
      unenforced: entries.filter((e) => e.outcome === 'UNENFORCED').map((e) => e.dataset),
      // Datasets where rows are past their window and waiting on a human to act.
      awaitingReview: entries
        // Boolean(), not `(e.eligible ?? 0) > 0`: a REPORT_ONLY entry always carries a count, so
        // the nullish half could never be taken and only pretended to guard something.
        .filter((e) => e.outcome === 'REPORT_ONLY' && Boolean(e.eligible))
        .map((e) => e.dataset),
      ok:
        !entries.some((e) => e.outcome === 'FAILED') ||
        entries.some((e) => e.outcome === 'PURGED' || e.outcome === 'REPORT_ONLY'),
    };
    this.logger.log(
      `Retention sweep${dryRun ? ' (dry run)' : ''}: deleted ${result.totalDeleted}, unenforced ${result.unenforced.length}`,
    );
    return result;
  }
}
