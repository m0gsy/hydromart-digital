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

/** Backup status is READ-ONLY — no backup engine is wired. "NONE" = never run. */
export interface BackupStatusRecord {
  status: string;
  lastBackupAt: Date | null;
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
}
