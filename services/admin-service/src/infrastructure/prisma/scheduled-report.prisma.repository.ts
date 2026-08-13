import { Injectable } from '@nestjs/common';

import { ExportFormat } from '../../domain/export';
import { ReportCadence } from '../../domain/report-cadence';
import { ReportDataset } from '../../domain/report-dataset';
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
  dataset: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
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
      dataset: row.dataset as ReportDataset,
    };
  }

  async list(): Promise<ScheduledReportRecord[]> {
    const rows = await this.prisma.scheduledReport.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => this.toRecord(r));
  }

  async findDue(now: Date, limit: number): Promise<ScheduledReportRecord[]> {
    // NULL counts as due: a schedule written before the executor existed was never
    // stamped, and reading that as "not yet" would leave it waiting forever.
    const rows = await this.prisma.scheduledReport.findMany({
      where: { enabled: true, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
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
