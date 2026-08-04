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
  /**
   * Opaque keyset cursor — the previous page's `nextCursor`. The audit log is append-only
   * and never stops growing, so an OFFSET deep into it walks everything before it
   * (audit Q-16). `page` is ignored when this is set.
   */
  cursor?: string;
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
  /**
   * Retention sweep (M23-21 enforcement): delete rows created strictly before `cutoff`,
   * returning how many went. The trail is append-only in normal operation; this is the
   * one sanctioned deletion path, and admin-service's policy is what drives it.
   */
  deleteOlderThan(cutoff: Date): Promise<number>;
  record(entry: AuditLogEntry): Promise<void>;
  /** HQ list: recent entries, newest first, with actor identity resolved. */
  list(
    query: AuditLogQuery,
  ): Promise<{ items: AuditLogListItem[]; total: number; nextCursor: string | null }>;
}
