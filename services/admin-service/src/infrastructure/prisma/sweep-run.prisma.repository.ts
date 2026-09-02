import { Injectable } from '@nestjs/common';

import {
  RecordSweepRun,
  SweepRunRecord,
  SweepRunRepository,
} from '../../application/ports/sweep-run.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class SweepRunPrismaRepository implements SweepRunRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One upsert per heartbeat (CA-5-01).
   *
   * The streak fields are computed from the row already in the table rather than sent by
   * the scheduler, because the scheduler has no memory: `sweep.sh` writes marker files that
   * a container restart wipes, and a retried tick would otherwise double-count. Reading the
   * previous row here means a repeated report of the same outcome advances the count by one
   * and nothing else.
   */
  async record(run: RecordSweepRun): Promise<SweepRunRecord> {
    const previous = await this.prisma.sweepRun.findUnique({ where: { job: run.job } });
    const consecutiveFailures = run.ok ? 0 : (previous?.consecutiveFailures ?? 0) + 1;
    // A failing round must NOT move lastOkAt — that field is the whole answer to "when did
    // this sweep last actually work", which is the question the old shared heartbeat could
    // not answer for any individual job.
    const lastOkAt = run.ok ? run.at : (previous?.lastOkAt ?? null);
    const data = {
      host: run.host,
      lastRunAt: run.at,
      ok: run.ok,
      detail: run.detail,
      lastOkAt,
      consecutiveFailures,
    };
    return this.prisma.sweepRun.upsert({
      where: { job: run.job },
      create: { job: run.job, ...data },
      update: data,
    });
  }

  async list(): Promise<SweepRunRecord[]> {
    // No pagination and no filter on purpose: the table holds one row per crontab line,
    // seventeen today, and the screen shows all of them at once.
    return this.prisma.sweepRun.findMany();
  }
}
