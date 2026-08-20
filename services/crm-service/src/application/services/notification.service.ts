import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { destinationFor } from '../../domain/notification-destination';
import { NotificationEvent, OPS_EVENTS, renderMessage, templateFor } from '../../domain/notification-event';
import { NotificationStatus } from '../../domain/notification-status';
import {
  NotificationRecord,
  NotificationRepository,
  OpsNotificationRecord,
} from '../ports/notification.repository';
import { NotificationPreferencePort } from '../ports/notification-preference.port';
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
    // Optional: crm shipped before this port existed, and a deployment that has not wired
    // it must keep sending rather than fall silent on an absent dependency.
    @Optional()
    @Inject(CRM_TOKENS.NotificationPreference)
    private readonly prefs?: NotificationPreferencePort,
  ) {}

  /**
   * Retention enforcement: drop notification history past its window. admin-service owns
   * the policy and passes the cutoff; this service owns the rows and does the deleting.
   */
  async purgeOlderThan(cutoff: Date): Promise<{ deleted: number }> {
    const deleted = await this.repo.deleteOlderThan(cutoff);
    this.logger.log(`Purged ${deleted} notifications older than ${cutoff.toISOString()}`);
    return { deleted };
  }

  /**
   * Whether this customer still wants push. Optional dependency: crm predates the port,
   * and a deployment that has not wired it must keep sending rather than go quiet.
   */
  private async pushAllowedFor(customerId: string): Promise<boolean> {
    if (!this.prefs) return true;
    try {
      return await this.prefs.pushAllowed(customerId);
    } catch (e) {
      // The adapter is meant to absorb its own outages, but the fail-open rule belongs
      // here too: an adapter that throws must cost an unwanted push, never a missing
      // order update. Without this the rejection would fall to the chain's `.catch` and
      // skip the send — failing CLOSED through the back door.
      this.logger.warn(`push preference unreadable, assuming allowed: ${(e as Error).message}`);
      return true;
    }
  }

  async notify(
    event: NotificationEvent,
    phone: string,
    vars: Record<string, string>,
    customerId: string | null = null,
  ): Promise<NotificationRecord> {
    const message = renderMessage(templateFor(event), vars);
    // Best-effort Web Push to the customer's registered devices. Fire-and-forget: push
    // transport must never block or fail an already-committed notification.
    //
    // F1: the preference read joins the same fire-and-forget chain rather than being
    // awaited before it. Awaiting would put a cross-service round-trip in front of every
    // notification write — including the ones with no customer to push to — to decide
    // something that is best-effort anyway. The port fails open, so an outage costs an
    // unwanted push, never a missing order update. The inbox row below is written either
    // way: muting push is not muting the record.
    if (customerId) {
      void this.pushAllowedFor(customerId)
        .then((allowed) =>
          allowed
            ? this.push.sendToCustomer(customerId, {
                title: 'Hydromart',
                body: message,
                url: destinationFor(event, vars),
              })
            : undefined,
        )
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
