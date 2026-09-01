import { NotificationStatus } from '../../domain/notification-status';

export interface NotificationRecord {
  id: string;
  event: string;
  customerId: string | null;
  phone: string;
  message: string;
  status: NotificationStatus;
  error: string | null;
  /** O1: the in-app screen this notification opens, or null when it opens nothing. */
  destination: string | null;
  /** O6: the depot an operational row belongs to; null for customer rows and legacy rows. */
  depotId: string | null;
  createdAt: Date;
}

export interface RecordNotificationData {
  event: string;
  customerId: string | null;
  phone: string;
  message: string;
  status: NotificationStatus;
  error: string | null;
  destination: string | null;
  depotId: string | null;
}

/** A feed row plus the *calling* staff member's own read receipt (null = unread by them). */
export interface OpsNotificationRecord extends NotificationRecord {
  readAt: Date | null;
}

export interface NotificationRepository {
  /**
   * Retention sweep (M23-21 enforcement): delete notification history created strictly
   * before `cutoff`. Notification bodies carry a phone number and a message written for
   * one person, so this is the shortest-lived PII the platform holds — and the first
   * dataset worth actually enforcing rather than merely documenting.
   */
  deleteOlderThan(cutoff: Date): Promise<number>;

  /**
   * UU PDP item 13: forget one person NOW, not when their retention window happens to
   * expire. `docs/AUDIT_L3.md` §4.2 counted what "when the window expires" left standing —
   * 3.033 rows in `notifications` and 17 in `campaign_recipients`, each keyed on a phone
   * number the owner had asked us to forget.
   *
   * DELETE rather than scrub: these tables already have a DELETE retention executor and a
   * 90-day window, so removal is the treatment their own policy prescribes. Web-push
   * subscriptions go too — a device endpoint belongs to one person and to nothing else.
   *
   * Matched on id OR phone, because a recipient who never registered has no id.
   * Idempotent: a retry deletes nothing and is not an error.
   */
  erasePerson(customerId: string, phone: string | null): Promise<number>;

  /** Append a notification audit row. */
  record(data: RecordNotificationData): Promise<NotificationRecord>;

  /**
   * K5.4: the delivery this row promised did not happen. Called after the fire-and-forget
   * push chain settles, so the row exists first and the customer's inbox never waits on a
   * transport. A row nobody can find any more is not an error worth raising — the message
   * is still readable in the app either way.
   */
  markFailed(id: string, error: string): Promise<void>;

  /** A customer's own notification feed, newest first (backed by @@index([customerId, createdAt])). */
  listForCustomer(customerId: string, limit: number): Promise<NotificationRecord[]>;

  /**
   * Operational feed: notifications for the given events, newest first, with `staffId`'s
   * read receipt joined in. Read state is per staff member — the audit rows are shared.
   */
  /**
   * O6: `depotIds` scopes the feed. `undefined` = every depot (head office and the
   * director, who have no depot of their own). Rows with a null depot stay visible to
   * everyone: every ops row written before this column existed has one, and hiding a
   * depot's own history from it the day the filter shipped would be a worse lie than the
   * one the filter fixes.
   */
  listOpsFeedFor(
    events: string[],
    staffId: string,
    limit: number,
    depotIds?: readonly string[],
  ): Promise<OpsNotificationRecord[]>;

  /**
   * Idempotent read receipt. Returns the read timestamp (the existing one when already
   * read), or null when no notification with that id is in the ops event set.
   */
  markOpsRead(notificationId: string, events: string[], staffId: string): Promise<Date | null>;

  /** Idempotent mark-all over the same feed window. Returns how many rows were newly marked. */
  markAllOpsRead(events: string[], staffId: string, limit: number): Promise<number>;
}
