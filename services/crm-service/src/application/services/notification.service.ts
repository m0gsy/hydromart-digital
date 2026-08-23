import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { destinationFor, storedDestinationFor } from '../../domain/notification-destination';
import { NotificationEvent, OPS_EVENTS, renderMessage, templateFor } from '../../domain/notification-event';
import { NotificationStatus } from '../../domain/notification-status';
import {
  NotificationRecord,
  NotificationRepository,
  OpsNotificationRecord,
} from '../ports/notification.repository';
import { DepotStaffPort } from '../ports/depot-staff.port';
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
    // F8. Optional for the same reason as `prefs`: a deployment that has not wired it must
    // keep behaving exactly as it did, which is "ops alerts reach the feed and no device".
    @Optional()
    @Inject(CRM_TOKENS.DepotStaff)
    private readonly depotStaff?: DepotStaffPort,
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

  /**
   * F8. An operational alert has no customer, so it had no push: `notify()` skips the send
   * when `customerId` is null, and every ops event passes null because it is addressed to a
   * phone number rather than to an account. Stock low, stock untracked, a meter variance,
   * the twice-daily sales update — and a HIGH-severity courier incident. None of them had a
   * channel that could wake anybody; they landed in the ops feed and waited for somebody to
   * open a screen.
   *
   * With a depot on the alert, the recipients are that depot's active staff. Fire-and-forget
   * on the same chain as the customer push, and fail-soft the same way: the ops feed row is
   * already written by the time this runs, so an unreachable roster costs a push, never the
   * alert. `Promise.allSettled` because one staff member's dead endpoint must not silence
   * the rest of the shift.
   */
  private pushToDepotStaff(event: NotificationEvent, message: string, depotId: string, vars: Record<string, string>): void {
    if (!this.depotStaff) return;
    void this.depotStaff
      .staffIdsForDepot(depotId)
      .then(async (ids) => {
        if (ids.length === 0) {
          this.logger.warn(`${event} for depot ${depotId}: no staff to push to`);
          return;
        }
        await Promise.allSettled(
          ids.map((id) =>
            this.push.sendToCustomer(id, {
              title: 'Hydromart',
              body: message,
              url: destinationFor(event, vars),
            }),
          ),
        );
      })
      .catch((e) => this.logger.warn(`Ops push for ${event} failed: ${(e as Error).message}`));
  }

  async notify(
    event: NotificationEvent,
    phone: string,
    vars: Record<string, string>,
    customerId: string | null = null,
    depotId: string | null = null,
  ): Promise<NotificationRecord> {
    const message = renderMessage(templateFor(event), vars);
    /*
     * The row first, the transport after — the reverse of how this used to read.
     *
     * F1 keeps the push fire-and-forget: transport must never block or fail an
     * already-committed notification, and the preference read must not put a cross-service
     * round trip in front of every write. That is unchanged. What changes (K5.4) is that
     * the row is written BEFORE the push is fired, so the chain has an id to come back to
     * — and a push that dies stops being a log line reading "skipped" on a row that claims
     * it was sent. Until this, nothing in the system had ever written FAILED or filled the
     * `error` column: two columns whose whole job is to say a message did not arrive.
     */
    const record = await this.repo.record({
      event,
      customerId,
      phone,
      message,
      status: NotificationStatus.SENT,
      error: null,
      // O1a: the column ships and starts filling one release before the client reads it,
      // so the list is never half-tappable — by the time the reader lands, every row
      // written since this release already carries its destination.
      destination: storedDestinationFor(event, vars),
    });

    const failed = (e: unknown) => {
      const reason = (e as Error).message;
      this.logger.warn(`Push for ${event} failed: ${reason}`);
      // Fail-soft on the bookkeeping too: if THIS write dies the message is still in the
      // customer's inbox, and an unhandled rejection here would be a second outage on top
      // of the first.
      void this.repo
        .markFailed(record.id, reason)
        .catch((err) => this.logger.warn(`could not mark ${record.id} failed: ${(err as Error).message}`));
    };

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
        // A customer who muted push has not suffered a failed delivery — `pushAllowedFor`
        // resolves, nothing is sent, and the row stays SENT. Only a throw lands here.
        .catch(failed);
    } else if (depotId && OPS_EVENTS.includes(event)) {
      // No customer to push to, but a depot whose staff this is for. The preference check
      // above is deliberately NOT applied: it is a customer's mute on their own order
      // updates, not a staff member's opt-out from an incident at the depot they work at.
      this.pushToDepotStaff(event, message, depotId, vars);
    }
    return record;
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
