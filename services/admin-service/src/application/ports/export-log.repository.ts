import { ExportFormat, ExportStatus } from '../../domain/export';

export interface ExportLogRecord {
  id: string;
  dataset: string;
  requestedById: string | null;
  requestedByEmail: string;
  format: ExportFormat;
  rowCount: number | null;
  status: ExportStatus;
  fileName: string | null;
  /** True when the row holds a downloadable file. The bytes are never listed, only fetched. */
  hasFile: boolean;
  createdAt: Date;
}

export interface CreateExportLogData {
  dataset: string;
  requestedById?: string | null;
  requestedByEmail: string;
  format: ExportFormat;
  rowCount?: number | null;
  status?: ExportStatus;
  content?: Buffer | null;
  fileName?: string | null;
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
  /**
   * The stored file for one export, or null when the row has none.
   *
   * Deliberately a separate read: `list` renders a table, and shipping every file's bytes
   * into a page of that table would turn a screen into a download of everything at once.
   */
  findContent(id: string): Promise<{ fileName: string; content: Buffer } | null>;
}
