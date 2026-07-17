export interface RetentionPolicyRecord {
  id: string;
  dataset: string;
  windowLabel: string;
  windowDays: number;
  updatedAt: Date;
}

/** Backup status is READ-ONLY — no backup engine is wired. "NONE" = never run. */
export interface BackupStatusRecord {
  status: string;
  lastBackupAt: Date | null;
}

/** Update just the retention window of one dataset row. */
export interface UpdateRetentionData {
  windowLabel: string;
  windowDays: number;
}

export interface RetentionRepository {
  /** Retention rows, ordered by dataset. */
  listPolicies(): Promise<RetentionPolicyRecord[]>;
  /** Update a row's window. Null when the id is unknown. */
  updatePolicy(id: string, data: UpdateRetentionData): Promise<RetentionPolicyRecord | null>;
  /** Read the singleton backup status (honest default when never recorded). */
  getBackupStatus(): Promise<BackupStatusRecord | null>;
}
