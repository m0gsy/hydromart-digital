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
  createdAt: Date;
}

@Injectable()
export class ExportLogPrismaRepository implements ExportLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ExportLogRow): ExportLogRecord {
    return { ...row, format: row.format as ExportFormat, status: row.status as ExportStatus };
  }

  async list(filter: ListExportLogsFilter): Promise<ExportLogPage> {
    const where = {
      ...(filter.dataset ? { dataset: filter.dataset } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.exportLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.exportLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => this.toRecord(r)),
      total,
      page: filter.page,
      limit: filter.limit,
    };
  }

  async create(data: CreateExportLogData): Promise<ExportLogRecord> {
    const row = await this.prisma.exportLog.create({ data });
    return this.toRecord(row);
  }
}
