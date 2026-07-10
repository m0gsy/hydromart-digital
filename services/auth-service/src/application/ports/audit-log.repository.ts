export interface AuditLogEntry {
  customerId: string | null;
  action: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only security audit trail. */
export interface AuditLogRepository {
  record(entry: AuditLogEntry): Promise<void>;
}
