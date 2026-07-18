export interface AuditLogEntry {
  customerId: string | null;
  action: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  metadata?: Record<string, unknown>;
}

/** Filter for the HQ audit list. Newest-first, paginated. */
export interface AuditLogQuery {
  page: number;
  limit: number;
  /** Exact-match action filter (e.g. `depot.suspend`). */
  action?: string;
  /** Filter to one actor. */
  customerId?: string;
  /** Depot-scoped list (design 8b): matches `metadata.depotId`. */
  depotId?: string;
  /** Category chip (design 8b): OPNAME/RECEIPT/HARGA/SETORAN/STAF → action substrings. */
  type?: string;
}

/**
 * A single audit row enriched with the actor's current identity (resolved from the
 * Customer table by customerId). Actor fields are null for system events (no
 * customerId) or if the actor account no longer exists.
 */
export interface AuditLogListItem {
  id: string;
  customerId: string | null;
  action: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
}

/** Append-only security audit trail. */
export interface AuditLogRepository {
  record(entry: AuditLogEntry): Promise<void>;
  /** HQ list: recent entries, newest first, with actor identity resolved. */
  list(query: AuditLogQuery): Promise<{ items: AuditLogListItem[]; total: number }>;
}
