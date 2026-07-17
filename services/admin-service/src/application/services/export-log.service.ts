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
}
