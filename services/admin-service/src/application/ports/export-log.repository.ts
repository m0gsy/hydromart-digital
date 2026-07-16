import { ExportFormat, ExportStatus } from '../../domain/export';

export interface ExportLogRecord {
  id: string;
  dataset: string;
  requestedById: string | null;
  requestedByEmail: string;
  format: ExportFormat;
  rowCount: number | null;
  status: ExportStatus;
  createdAt: Date;
}

export interface CreateExportLogData {
  dataset: string;
  requestedById?: string | null;
  requestedByEmail: string;
  format: ExportFormat;
  rowCount?: number | null;
  status?: ExportStatus;
}

export interface ListExportLogsFilter {
  page: number;
  limit: number;
  dataset?: string;
  status?: ExportStatus;
}

export interface ExportLogPage {
  items: ExportLogRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface ExportLogRepository {
  list(filter: ListExportLogsFilter): Promise<ExportLogPage>;
  create(data: CreateExportLogData): Promise<ExportLogRecord>;
}
