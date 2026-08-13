import { Injectable } from '@nestjs/common';

import { ExportFormat, ExportStatus } from '../../domain/export';
import {
  CreateExportLogData,
  ExportLogPage,
  ExportLogRecord,
  ExportLogRepository,
  ListExportLogsFilter,
} from '../../application/ports/export-log.repository';
import { PrismaService } from './prisma.service';

interface ExportLogRow {
  id: string;
  dataset: string;
  requestedById: string | null;
  requestedByEmail: string;
  format: string;
  rowCount: number | null;
  status: string;
  fileName: string | null;
  createdAt: Date;
}

@Injectable()
export class ExportLogPrismaRepository implements ExportLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ExportLogRow & { hasFile?: boolean }): ExportLogRecord {
    return {
      ...row,
      format: row.format as ExportFormat,
      status: row.status as ExportStatus,
      hasFile: row.hasFile ?? false,
    };
  }

  async list(filter: ListExportLogsFilter): Promise<ExportLogPage> {
    const where = {
      ...(filter.dataset ? { dataset: filter.dataset } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await Promise.all([
      // `content` is deliberately NOT selected: a page of this table would otherwise be a
      // download of every file at once. `hasFile` is derived by a second, cheap read.
      this.prisma.exportLog.findMany({
        where,
        select: {
          id: true,
          dataset: true,
          requestedById: true,
          requestedByEmail: true,
          format: true,
          rowCount: true,
          status: true,
          fileName: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.exportLog.count({ where }),
    ]);
    return {
      // A row has a file exactly when the sweep stored one under a name.
      items: rows.map((r) => this.toRecord({ ...r, hasFile: r.fileName !== null })),
      total,
      page: filter.page,
      limit: filter.limit,
    };
  }

  async create(data: CreateExportLogData): Promise<ExportLogRecord> {
    const row = await this.prisma.exportLog.create({ data });
    return this.toRecord({ ...row, hasFile: row.fileName !== null });
  }

  async findContent(id: string): Promise<{ fileName: string; content: Buffer } | null> {
    const row = await this.prisma.exportLog.findUnique({
      where: { id },
      select: { fileName: true, content: true },
    });
    if (!row?.content || !row.fileName) return null;
    return { fileName: row.fileName, content: Buffer.from(row.content) };
  }
}
