import { Inject, Injectable } from '@nestjs/common';

import {
  CreateExportLogData,
  ExportLogPage,
  ExportLogRecord,
  ExportLogRepository,
  ListExportLogsFilter,
} from '../ports/export-log.repository';
import { ADMIN_TOKENS } from '../tokens';

@Injectable()
export class ExportLogService {
  constructor(
    @Inject(ADMIN_TOKENS.ExportLogRepository) private readonly repo: ExportLogRepository,
  ) {}

  /** Paginated export log (Design 13c), newest first, optionally filtered. */
  list(filter: ListExportLogsFilter): Promise<ExportLogPage> {
    return this.repo.list(filter);
  }

  /** Record an export job (internal-key ingest). */
  ingest(data: CreateExportLogData): Promise<ExportLogRecord> {
    return this.repo.create(data);
  }

  /**
   * The stored file for one export, or null when the row has none.
   *
   * Separate from `list` on purpose: a page of the table would otherwise ship every file's
   * bytes at once, and the point of holding them in the row is that they are fetched one
   * at a time by somebody who asked for that one.
   */
  download(id: string): Promise<{ fileName: string; content: Buffer } | null> {
    return this.repo.findContent(id);
  }
}
