import { Injectable } from '@nestjs/common';

import { ExportFormat } from '../../domain/export';
import { ReportCadence } from '../../domain/report-cadence';
import {
  CreateScheduledReportData,
  ScheduledReportRecord,
  ScheduledReportRepository,
  UpdateScheduledReportData,
} from '../../application/ports/scheduled-report.repository';
import { PrismaService } from './prisma.service';

interface ScheduledReportRow {
  id: string;
  name: string;
  cadence: string;
  recipients: string[];
  format: string;
  nextRunAt: Date | null;
  enabled: boolean;
  createdAt: Date;
}

@Injectable()
export class ScheduledReportPrismaRepository implements ScheduledReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ScheduledReportRow): ScheduledReportRecord {
    return {
      ...row,
      cadence: row.cadence as ReportCadence,
      format: row.format as ExportFormat,
    };
  }

  async list(): Promise<ScheduledReportRecord[]> {
    const rows = await this.prisma.scheduledReport.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toRecord(r));
  }

  async create(data: CreateScheduledReportData): Promise<ScheduledReportRecord> {
    const row = await this.prisma.scheduledReport.create({ data });
    return this.toRecord(row);
  }

  async update(id: string, data: UpdateScheduledReportData): Promise<ScheduledReportRecord | null> {
    const existing = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.prisma.scheduledReport.update({ where: { id }, data });
    return this.toRecord(row);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.prisma.scheduledReport.findUnique({ where: { id } });
    if (!existing) return false;
    await this.prisma.scheduledReport.delete({ where: { id } });
    return true;
  }
}
