import { ExportFormat } from '../../domain/export';
import { ReportCadence } from '../../domain/report-cadence';

export interface ScheduledReportRecord {
  id: string;
  name: string;
  cadence: ReportCadence;
  recipients: string[];
  format: ExportFormat;
  nextRunAt: Date | null;
  enabled: boolean;
  createdAt: Date;
}

export interface CreateScheduledReportData {
  name: string;
  cadence: ReportCadence;
  recipients: string[];
  format?: ExportFormat;
  nextRunAt?: Date | null;
  enabled?: boolean;
}

/** Fields a PATCH may change on a schedule (all optional; at least one supplied). */
export interface UpdateScheduledReportData {
  name?: string;
  cadence?: ReportCadence;
  recipients?: string[];
  format?: ExportFormat;
  nextRunAt?: Date | null;
  enabled?: boolean;
}

export interface ScheduledReportRepository {
  list(): Promise<ScheduledReportRecord[]>;
  create(data: CreateScheduledReportData): Promise<ScheduledReportRecord>;
  update(id: string, data: UpdateScheduledReportData): Promise<ScheduledReportRecord | null>;
  remove(id: string): Promise<boolean>;
}
