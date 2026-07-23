import { Inject, Injectable, Logger } from '@nestjs/common';

import { NotificationEvent, OPS_EVENTS, renderMessage, templateFor } from '../../domain/notification-event';
import { NotificationStatus } from '../../domain/notification-status';
import {
  NotificationRecord,
  NotificationRepository,
  OpsNotificationRecord,
} from '../ports/notification.repository';
import { PushService } from './push.service';
import { CRM_TOKENS } from '../tokens';

/**
 * Event-triggered transactional notifications (FR-093/FR-094). Fired by upstream services
 * (order-service) on lifecycle changes. Delivered via the in-app inbox (stored here) + Web
 * Push; the WhatsApp transport was removed (marketing campaigns still use WhatsApp). Never
 * throws — the notification is a side-effect of an already-committed business action.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(CRM_TOKENS.NotificationRepository) private readonly repo: NotificationRepository,
    private readonly push: PushService,
  ) {}

  async notify(
    event: NotificationEvent,
    phone: string,
    vars: Record<string, string>,
    customerId: string | null = null,
  ): Promise<NotificationRecord> {
    const message = renderMessage(templateFor(event), vars);
    // Best-effort Web Push to the customer's registered devices. Fire-and-forget: push
    // transport must never block or fail an already-committed notification.
    if (customerId) {
      void this.push
        .sendToCustomer(customerId, { title: 'Hydromart', body: message, url: '/notifications' })
        .catch((e) => this.logger.warn(`Push for ${event} failed: ${(e as Error).message}`));
    }
    return this.repo.record({
      event,
      customerId,
      phone,
      message,
      status: NotificationStatus.SENT,
      error: null,
    });
  }

  /** A customer's own notification inbox, newest first. */
  async listForCustomer(customerId: string, limit = 30): Promise<NotificationRecord[]> {
    return this.repo.listForCustomer(customerId, Math.min(Math.max(limit, 1), 100));
  }

  /**
   * Staff operational feed (PRD 10d): recent notifications for operational events, with
   * the caller's own read receipts. Read state is per staff member, never shared.
   */
  async listOpsFeed(staffId: string, limit = 50): Promise<OpsNotificationRecord[]> {
    return this.repo.listOpsFeedFor(OPS_EVENTS, staffId, clampLimit(limit));
  }

  /** Mark one ops notification read for this staff member. Idempotent; null when unknown. */
  async markOpsRead(notificationId: string, staffId: string): Promise<Date | null> {
    return this.repo.markOpsRead(notificationId, OPS_EVENTS, staffId);
  }

  /** Mark the whole current feed window read for this staff member. Idempotent. */
  async markAllOpsRead(staffId: string, limit = 50): Promise<number> {
    return this.repo.markAllOpsRead(OPS_EVENTS, staffId, clampLimit(limit));
  }
}

const clampLimit = (limit: number): number => Math.min(Math.max(limit, 1), 100);
