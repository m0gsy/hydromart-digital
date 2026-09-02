import { Inject, Injectable } from '@nestjs/common';

import {
  RecordSweepRun,
  SweepRunRecord,
  SweepRunRepository,
} from '../ports/sweep-run.repository';
import { ADMIN_TOKENS } from '../tokens';
import {
  SWEEP_SCHEDULE,
  SweepVerdict,
  overdueAfterMinutes,
  verdictFor,
} from '../../domain/sweep-schedule';

/** One scheduled sweep as the console shows it: the schedule, plus whatever it last did. */
export interface SweepStatus {
  job: string;
  label: string;
  everyMinutes: number;
  verdict: SweepVerdict;
  /** Why this sweep is switched off, when it is. Null for every live sweep. */
  dormantReason: string | null;
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  ok: boolean | null;
  detail: string | null;
  consecutiveFailures: number;
  host: string | null;
  /** Minutes after which this sweep counts as stopped, so the screen can say the rule. */
  overdueAfterMinutes: number;
}

@Injectable()
export class SweepService {
  constructor(
    @Inject(ADMIN_TOKENS.SweepRunRepository) private readonly runs: SweepRunRepository,
  ) {}

  record(run: RecordSweepRun): Promise<SweepRunRecord> {
    return this.runs.record(run);
  }

  /**
   * Every scheduled sweep and how it is doing (CA-5-01).
   *
   * Driven by SWEEP_SCHEDULE, never by the table. This is the entire point of the feature:
   * a table can only show a job that has REPORTED, and a job that has never reported is not
   * a job with nothing to say — it is a job that is not running. Both of the sweeps found
   * dead on the box this was written on (`subscriptions/process-due`,
   * `webhooks/deliveries/process`) were in exactly that state, with no marker file of either
   * kind, and the container healthcheck still answered for them because a DIFFERENT sweep
   * had succeeded recently.
   *
   * Sorted worst-first, so the screen opens on the problem rather than on an alphabet.
   */
  async list(now: Date = new Date()): Promise<SweepStatus[]> {
    const rows = new Map((await this.runs.list()).map((r) => [r.job, r]));
    const statuses = SWEEP_SCHEDULE.map((sweep) => {
      const run = rows.get(sweep.job) ?? null;
      return {
        job: sweep.job,
        label: sweep.label,
        everyMinutes: sweep.everyMinutes,
        verdict: verdictFor(sweep, run, now),
        dormantReason: sweep.dormant ?? null,
        lastRunAt: run?.lastRunAt ?? null,
        lastOkAt: run?.lastOkAt ?? null,
        ok: run?.ok ?? null,
        detail: run?.detail ?? null,
        consecutiveFailures: run?.consecutiveFailures ?? 0,
        host: run?.host ?? null,
        overdueAfterMinutes: overdueAfterMinutes(sweep.everyMinutes),
      };
    });
    return statuses.sort((a, b) => SEVERITY[a.verdict] - SEVERITY[b.verdict]);
  }
}

/**
 * Worst first. NEVER_RAN outranks FAILING because a sweep that has never run once is a
 * feature that has never worked, while a failing one at least reached its service; and
 * DORMANT sorts last of all, below OK, because it is a decision rather than a fault.
 */
const SEVERITY: Record<SweepVerdict, number> = {
  NEVER_RAN: 0,
  OVERDUE: 1,
  FAILING: 2,
  OK: 3,
  DORMANT: 4,
};
