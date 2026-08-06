import { Inject, Injectable } from '@nestjs/common';

import { RetentionPolicyInvalidError, RetentionPolicyNotFoundError } from '../../domain/errors';
import { DataClass, isPurgeExempt, purgeCutoff, rejectionReasonFor } from '../../domain/retention';
import {
  BackupStatusRecord,
  RecordBackupRunData,
  RetentionPolicyRecord,
  RetentionRepository,
  UpdateRetentionData,
} from '../ports/retention.repository';
import { ADMIN_TOKENS } from '../tokens';

// Honest default when no backup engine has ever recorded a run (Design 19e). Never a
// fabricated "success just now".
const BACKUP_DEFAULT: BackupStatusRecord = {
  status: 'NONE',
  lastBackupAt: null,
  detail: null,
  drillStatus: 'NONE',
  lastDrillAt: null,
  drillDetail: null,
};

/** What a purge job may delete for one dataset, and from when (M23-21). */
export interface PurgePlanEntry {
  dataset: string;
  dataClass: DataClass;
  purgeExempt: boolean;
  /** Null when nothing is eligible — exempt class or a non-positive window. */
  cutoff: Date | null;
}

@Injectable()
export class RetentionService {
  constructor(
    @Inject(ADMIN_TOKENS.RetentionRepository) private readonly repo: RetentionRepository,
  ) {}

  listPolicies(): Promise<RetentionPolicyRecord[]> {
    return this.repo.listPolicies();
  }

  /**
   * Update one dataset's retention window. 404 when the id is unknown.
   *
   * M23-21: the legal floor is enforced here, not in the UI. Shortening financial
   * retention below 10 years is refused outright — a form that forgets to disable the
   * field must not be able to make the company non-compliant.
   */
  async updatePolicy(id: string, data: UpdateRetentionData): Promise<RetentionPolicyRecord> {
    const current = await this.repo.findPolicy(id);
    if (!current) throw new RetentionPolicyNotFoundError(id);

    const dataClass = data.dataClass ?? current.dataClass;
    const reason = rejectionReasonFor(dataClass, data.windowDays);
    if (reason) throw new RetentionPolicyInvalidError(reason);

    const updated = await this.repo.updatePolicy(id, { ...data, dataClass });
    if (!updated) throw new RetentionPolicyNotFoundError(id);
    return updated;
  }

  /**
   * The cutoff a purge job may delete before, per dataset. Financial rows report null —
   * they are never eligible. No purge engine exists yet; this is the contract the one
   * that gets written must call rather than re-deriving the rule.
   */
  async purgeCutoffs(now: Date = new Date()): Promise<PurgePlanEntry[]> {
    const policies = await this.repo.listPolicies();
    return policies.map((p) => ({
      dataset: p.dataset,
      dataClass: p.dataClass,
      purgeExempt: isPurgeExempt(p.dataClass),
      cutoff: purgeCutoff(p.dataClass, p.windowDays, now),
    }));
  }

  /** Last recorded backup + tested-restore status (honest default when neither has run). */
  async getBackupStatus(): Promise<BackupStatusRecord> {
    return (await this.repo.getBackupStatus()) ?? BACKUP_DEFAULT;
  }

  /**
   * Record what the nightly dump or the weekly restore drill actually did (H-37).
   *
   * The console used to show a status nothing could ever write, next to a cron job that
   * had been dumping the cluster for months — "NONE" forever, whether or not backups
   * worked. FAILED is as important as OK here: a silent failure into a log nobody reads
   * is what manufactures confidence in an unusable backup.
   */
  recordBackupRun(data: RecordBackupRunData): Promise<BackupStatusRecord> {
    return this.repo.recordBackupRun(data);
  }
}
