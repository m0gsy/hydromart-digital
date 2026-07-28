import { Injectable } from '@nestjs/common';

import {
  BackupStatusRecord,
  RetentionPolicyRecord,
  RetentionRepository,
  UpdateRetentionData,
} from '../../application/ports/retention.repository';
import { DataClass, isDataClass, isPurgeExempt } from '../../domain/retention';
import { PrismaService } from './prisma.service';

const BACKUP_SINGLETON_ID = 'singleton';

@Injectable()
export class RetentionPrismaRepository implements RetentionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listPolicies(): Promise<RetentionPolicyRecord[]> {
    const rows = await this.prisma.retentionPolicy.findMany({ orderBy: { dataset: 'asc' } });
    return rows.map((r) => this.toRecord(r));
  }

  async findPolicy(id: string): Promise<RetentionPolicyRecord | null> {
    const row = await this.prisma.retentionPolicy.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async updatePolicy(id: string, data: UpdateRetentionData): Promise<RetentionPolicyRecord | null> {
    const existing = await this.prisma.retentionPolicy.findUnique({ where: { id } });
    if (!existing) return null;
    return this.toRecord(await this.prisma.retentionPolicy.update({ where: { id }, data }));
  }

  /**
   * `purgeExempt` is DERIVED, never stored — one source of truth for "may this be
   * deleted", so a hand-edited row cannot claim financial data is purgeable.
   */
  private toRecord(row: {
    id: string;
    dataset: string;
    windowLabel: string;
    windowDays: number;
    dataClass: string;
    updatedAt: Date;
  }): RetentionPolicyRecord {
    const dataClass = isDataClass(row.dataClass) ? row.dataClass : DataClass.OPERATIONAL;
    return { ...row, dataClass, purgeExempt: isPurgeExempt(dataClass) };
  }

  async getBackupStatus(): Promise<BackupStatusRecord | null> {
    const row = await this.prisma.backupStatus.findUnique({ where: { id: BACKUP_SINGLETON_ID } });
    return row ? { status: row.status, lastBackupAt: row.lastBackupAt } : null;
  }
}
