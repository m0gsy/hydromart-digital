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

export interface NotificationRepository {
  /** Append a notification audit row. */
  record(data: RecordNotificationData): Promise<NotificationRecord>;

  /** A customer's own notification feed, newest first (backed by @@index([customerId, createdAt])). */
  listForCustomer(customerId: string, limit: number): Promise<NotificationRecord[]>;

  /** Operational feed: notifications for the given events, newest first (staff ops center). */
  listByEvents(events: string[], limit: number): Promise<NotificationRecord[]>;
}
