import { Inject, Injectable, Logger } from '@nestjs/common';

import { ExportStatus } from '../../domain/export';
import { renderReport, reportFileName } from '../../domain/report-file';
import { nextRunAfter, reportWindow } from '../../domain/report-window';
import { ExportLogRepository } from '../ports/export-log.repository';
import { ReportSourcePort } from '../ports/report-source.port';
import {
  ScheduledReportRecord,
  ScheduledReportRepository,
} from '../ports/scheduled-report.repository';
import { ADMIN_TOKENS } from '../tokens';

/** What one sweep tick got through. Reported to the caller and to the cron log. */
export interface ReportSweepResult {
  due: number;
  produced: number;
  failed: number;
  /**
   * J7: false when reports came due and none of them was produced.
   *
   * `failed` was counted and unread — `sweep.sh` refreshed the scheduler heartbeat on the
   * HTTP 200 alone, so an hour where every due report threw wrote the same green marker
   * as an hour with nothing due.
   */
  ok: boolean;
}

/**
 * Runs the scheduled reports that have come due (design 15c).
 *
 * This did not exist. The screen had full CRUD, `nextRunAt` was documented as "advisory
 * metadata for the future scheduler", and nothing ever produced a file — which is also why
 * `hq/exports` was permanently empty: nothing wrote an export log either.
 *
 * Delivery is NOT email. There is no mail transport anywhere in this repo, so a run that
 * claimed to have sent one would be the same lie one layer down. The file is stored on the
 * export-log row and downloaded from `hq/exports`; `recipients` stays on the schedule as
 * the list to mail once a transport exists.
 */
@Injectable()
export class ScheduledReportRunnerService {
  /**
   * Schedules per tick. Bounded like every other sweep here: a tick is a unit of progress,
   * and whatever is not reached stays due for the next one.
   */
  private static readonly MAX_PER_SWEEP = 10;
  private readonly logger = new Logger(ScheduledReportRunnerService.name);

  constructor(
    @Inject(ADMIN_TOKENS.ScheduledReportRepository)
    private readonly schedules: ScheduledReportRepository,
    @Inject(ADMIN_TOKENS.ExportLogRepository) private readonly logs: ExportLogRepository,
    @Inject(ADMIN_TOKENS.ReportSource) private readonly source: ReportSourcePort,
  ) {}

  async runDue(now = new Date()): Promise<ReportSweepResult> {
    const due = await this.schedules.findDue(now, ScheduledReportRunnerService.MAX_PER_SWEEP);
    const result: ReportSweepResult = { due: due.length, produced: 0, failed: 0, ok: true };

    for (const schedule of due) {
      const ok = await this.runOne(schedule, now);
      if (ok) result.produced += 1;
      else result.failed += 1;
      // Stamped whether it worked or not. A schedule that fails every tick must not become
      // a hot loop that re-runs it every minute and fills the export log with failures.
      await this.schedules.update(schedule.id, {
        lastRunAt: now,
        nextRunAt: nextRunAfter(schedule.cadence, now),
      });
    }
    result.ok = result.failed === 0 || result.produced > 0;
    return result;
  }

  private async runOne(schedule: ScheduledReportRecord, now: Date): Promise<boolean> {
    const { from, to } = reportWindow(schedule.cadence, now);
    try {
      const rows = await this.source.rowsFor(schedule.dataset, from, to);
      const content = await renderReport(rows, schedule.format, schedule.name);
      await this.logs.create({
        dataset: schedule.dataset,
        requestedByEmail: schedule.recipients[0] ?? 'scheduler',
        format: schedule.format,
        rowCount: rows.length,
        status: ExportStatus.DONE,
        content,
        fileName: reportFileName(schedule.name, from, schedule.format),
      });
      return true;
    } catch (error) {
      // The failure is RECORDED, not swallowed. An unreachable service would otherwise
      // produce an empty spreadsheet, and an empty revenue report reads as a quiet month
      // rather than as an outage — the one confusion this whole feature exists to avoid.
      this.logger.warn(`scheduled report ${schedule.id} failed: ${(error as Error).message}`);
      await this.logs.create({
        dataset: schedule.dataset,
        requestedByEmail: schedule.recipients[0] ?? 'scheduler',
        format: schedule.format,
        rowCount: null,
        status: ExportStatus.FAILED,
      });
      return false;
    }
  }
}
