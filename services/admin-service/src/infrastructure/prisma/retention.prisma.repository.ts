import { Injectable } from '@nestjs/common';

import {
  BackupStatusRecord,
  RetentionPolicyRecord,
  RetentionRepository,
  UpdateRetentionData,
} from '../../application/ports/retention.repository';
import { PrismaService } from './prisma.service';

const BACKUP_SINGLETON_ID = 'singleton';

@Injectable()
export class RetentionPrismaRepository implements RetentionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listPolicies(): Promise<RetentionPolicyRecord[]> {
    return this.prisma.retentionPolicy.findMany({ orderBy: { dataset: 'asc' } });
  }

  async updatePolicy(id: string, data: UpdateRetentionData): Promise<RetentionPolicyRecord | null> {
    const existing = await this.prisma.retentionPolicy.findUnique({ where: { id } });
    if (!existing) return null;
    return this.prisma.retentionPolicy.update({ where: { id }, data });
  }

  async getBackupStatus(): Promise<BackupStatusRecord | null> {
    const row = await this.prisma.backupStatus.findUnique({ where: { id: BACKUP_SINGLETON_ID } });
    return row ? { status: row.status, lastBackupAt: row.lastBackupAt } : null;
  }
}
