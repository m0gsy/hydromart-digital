import { ExportFormat } from '../../domain/export';
import { ReportCadence } from '../../domain/report-cadence';
import { ReportDataset } from '../../domain/report-dataset';

export interface ScheduledReportRecord {
  id: string;
  name: string;
  cadence: ReportCadence;
  recipients: string[];
  format: ExportFormat;
  dataset: ReportDataset;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  /** CA-2-66: whether that run produced the file. Null = never run. */
  lastRunOk: boolean | null;
  /** Why it failed, when it did. Null when it worked, or never ran. */
  lastError: string | null;
  enabled: boolean;
  createdAt: Date;
}

export interface CreateScheduledReportData {
  name: string;
  cadence: ReportCadence;
  recipients: string[];
  format?: ExportFormat;
  dataset?: ReportDataset;
  nextRunAt?: Date | null;
  enabled?: boolean;
}

/** Fields a PATCH may change on a schedule (all optional; at least one supplied). */
export interface UpdateScheduledReportData {
  name?: string;
  cadence?: ReportCadence;
  recipients?: string[];
  format?: ExportFormat;
  dataset?: ReportDataset;
  nextRunAt?: Date | null;
  lastRunAt?: Date | null;
  lastRunOk?: boolean | null;
  lastError?: string | null;
  enabled?: boolean;
}

export interface ScheduledReportRepository {
  list(): Promise<ScheduledReportRecord[]>;
  /**
   * Enabled schedules whose time has come, oldest first, bounded per tick.
   *
   * A NULL `nextRunAt` counts as due: a schedule created before the executor existed has
   * never been stamped, and treating it as "not due yet" would leave it never running.
   */
  findDue(now: Date, limit: number): Promise<ScheduledReportRecord[]>;
  create(data: CreateScheduledReportData): Promise<ScheduledReportRecord>;
  update(id: string, data: UpdateScheduledReportData): Promise<ScheduledReportRecord | null>;
  remove(id: string): Promise<boolean>;
}
