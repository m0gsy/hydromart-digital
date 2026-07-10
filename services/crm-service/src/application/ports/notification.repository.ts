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
}
