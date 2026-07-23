import { NotificationStatus } from '../../domain/notification-status';

export interface NotificationRecord {
  id: string;
  event: string;
  customerId: string | null;
  phone: string;
  message: string;
  status: NotificationStatus;
  error: string | null;
  createdAt: Date;
}

export interface RecordNotificationData {
  event: string;
  customerId: string | null;
  phone: string;
  message: string;
  status: NotificationStatus;
  error: string | null;
}

/** A feed row plus the *calling* staff member's own read receipt (null = unread by them). */
export interface OpsNotificationRecord extends NotificationRecord {
  readAt: Date | null;
}

export interface NotificationRepository {
  /** Append a notification audit row. */
  record(data: RecordNotificationData): Promise<NotificationRecord>;

  /** A customer's own notification feed, newest first (backed by @@index([customerId, createdAt])). */
  listForCustomer(customerId: string, limit: number): Promise<NotificationRecord[]>;

  /**
   * Operational feed: notifications for the given events, newest first, with `staffId`'s
   * read receipt joined in. Read state is per staff member — the audit rows are shared.
   */
  listOpsFeedFor(events: string[], staffId: string, limit: number): Promise<OpsNotificationRecord[]>;

  /**
   * Idempotent read receipt. Returns the read timestamp (the existing one when already
   * read), or null when no notification with that id is in the ops event set.
   */
  markOpsRead(notificationId: string, events: string[], staffId: string): Promise<Date | null>;

  /** Idempotent mark-all over the same feed window. Returns how many rows were newly marked. */
  markAllOpsRead(events: string[], staffId: string, limit: number): Promise<number>;
}
