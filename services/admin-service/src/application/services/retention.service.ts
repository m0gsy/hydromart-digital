import { Inject, Injectable } from '@nestjs/common';

import { RetentionPolicyNotFoundError } from '../../domain/errors';
import {
  BackupStatusRecord,
  RetentionPolicyRecord,
  RetentionRepository,
  UpdateRetentionData,
} from '../ports/retention.repository';
import { ADMIN_TOKENS } from '../tokens';

// Honest default when no backup engine has ever recorded a run (Design 19e). Never a
// fabricated "success just now".
const BACKUP_DEFAULT: BackupStatusRecord = { status: 'NONE', lastBackupAt: null };

@Injectable()
export class RetentionService {
  constructor(
    @Inject(ADMIN_TOKENS.RetentionRepository) private readonly repo: RetentionRepository,
  ) {}

  listPolicies(): Promise<RetentionPolicyRecord[]> {
    return this.repo.listPolicies();
  }

  /** Update one dataset's retention window. 404 when the id is unknown. */
  async updatePolicy(id: string, data: UpdateRetentionData): Promise<RetentionPolicyRecord> {
    const updated = await this.repo.updatePolicy(id, data);
    if (!updated) throw new RetentionPolicyNotFoundError(id);
    return updated;
  }

  /** Read-only backup status (no backup engine wired → honest default when unset). */
  async getBackupStatus(): Promise<BackupStatusRecord> {
    return (await this.repo.getBackupStatus()) ?? BACKUP_DEFAULT;
  }
}
