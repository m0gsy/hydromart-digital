import { Inject, Injectable, Optional } from '@nestjs/common';
import { AUDIT_MUTATION_SINK, AuditMutationSink } from '@hydromart/platform';

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
    // AAS-16. Optional: without a sink a download is served exactly as before.
    @Optional() @Inject(AUDIT_MUTATION_SINK) private readonly audit?: AuditMutationSink,
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
  async download(id: string, actorId: string): Promise<{ fileName: string; content: Buffer } | null> {
    const file = await this.repo.findContent(id);
    // AAS-16: a GET never reaches the mutation interceptor, so the download names itself.
    if (file) {
      await this.audit?.record({
        action: 'export.download',
        actorId,
        target: id,
        metadata: { fileName: file.fileName },
      });
    }
    return file;
  }
}
