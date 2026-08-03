import { DataClass } from '../../domain/retention';

export interface RetentionPolicyRecord {
  id: string;
  dataset: string;
  windowLabel: string;
  windowDays: number;
  /** M23-21: decides whether a purge may touch this dataset at all. */
  dataClass: DataClass;
  /** Derived from dataClass — FINANCIAL data is never purged. */
  purgeExempt: boolean;
  updatedAt: Date;
}

/**
 * What the backup and restore-drill jobs last reported (H-37). "NONE" = never run.
 *
 * The drill verdict is a separate field from the backup verdict on purpose (H-36): a dump
 * existing and a dump having been restored are different claims, and only the second one
 * makes it a backup.
 */
export interface BackupStatusRecord {
  status: string;
  lastBackupAt: Date | null;
  detail: string | null;
  drillStatus: string;
  lastDrillAt: Date | null;
  drillDetail: string | null;
}

/** One job's outcome. `kind` picks which pair of columns it lands in. */
export interface RecordBackupRunData {
  kind: 'BACKUP' | 'DRILL';
  status: 'OK' | 'FAILED';
  at: Date;
  detail: string | null;
}

/** Update the retention window (and optionally the class) of one dataset row. */
export interface UpdateRetentionData {
  windowLabel: string;
  windowDays: number;
  dataClass?: DataClass;
}

export interface RetentionRepository {
  /** Retention rows, ordered by dataset. */
  listPolicies(): Promise<RetentionPolicyRecord[]>;
  /** One row by id, so an edit can be validated against its CURRENT class. */
  findPolicy(id: string): Promise<RetentionPolicyRecord | null>;
  /** Update a row's window. Null when the id is unknown. */
  updatePolicy(id: string, data: UpdateRetentionData): Promise<RetentionPolicyRecord | null>;
  /** Read the singleton backup status (honest default when never recorded). */
  getBackupStatus(): Promise<BackupStatusRecord | null>;
  /** Upsert the singleton with one job's outcome, leaving the other job's fields alone. */
  recordBackupRun(data: RecordBackupRunData): Promise<BackupStatusRecord>;
}
