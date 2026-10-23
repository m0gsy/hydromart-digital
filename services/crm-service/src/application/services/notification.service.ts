import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { destinationFor, storedDestinationFor } from '../../domain/notification-destination';
import {
  MessageLocale,
  NotificationEvent,
  OPS_EVENTS,
  OVERSEER_EVENTS,
  STAFF_TOGGLE_FOR_EVENT,
  renderMessage,
  templateFor,
} from '../../domain/notification-event';
import { NotificationStatus } from '../../domain/notification-status';
import {
  NotificationRecord,
  NotificationRepository,
  OpsNotificationRecord,
} from '../ports/notification.repository';
import { DepotStaffPort } from '../ports/depot-staff.port';
import { NotificationPreferencePort } from '../ports/notification-preference.port';
import { StaffPrefsPort } from '../ports/staff-prefs.port';
import { DepotOverseersPort } from '../ports/depot-overseers.port';
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
    // Optional like the two above: without it every staff switch reads as on, which is how
    // crm behaved before the switches were wired to anything.
    @Optional()
    @Inject(CRM_TOKENS.StaffPrefs)
    private readonly staffPrefs?: StaffPrefsPort,
    // Optional too: without it only the depot's own staff are woken, as before.
    @Optional()
    @Inject(CRM_TOKENS.DepotOverseers)
    private readonly overseers?: DepotOverseersPort,
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
   * UU PDP item 13: forget one person across every table this service keeps them in.
   *
   * Called by auth-service's erasure registry, which reports a dataset it cannot reach as
   * UNENFORCED rather than skipping it — so this endpoint existing at all is half the fix.
   */
  async erasePerson(customerId: string, phone: string | null): Promise<{ erased: number }> {
    const erased = await this.repo.erasePerson(customerId, phone);
    this.logger.log(`PDP erasure: removed ${erased} crm row(s) for ${customerId}`);
    return { erased };
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
   * K5.3: the language to write this message in.
   *
   * Unlike `pushAllowedFor`, this one is awaited BEFORE the row is written, and that is a
   * deliberate exception to F1's "no round trip in front of every write". The push
   * preference only gates a side-effect that happens afterwards; the language decides the
   * TEXT that goes into the row, and the inbox keeps that text forever. Rendering first and
   * asking later would mean storing Indonesian and pushing English.
   *
   * Only for customer-addressed events: an ops alert is addressed to a depot's number, not
   * to an account, and has no customer whose language could be read. Fails open to
   * Indonesian, the product default, on any failure at all.
   */
  private async localeFor(customerId: string | null, event: NotificationEvent): Promise<MessageLocale> {
    if (!customerId || !this.prefs || OPS_EVENTS.includes(event)) return 'id';
    try {
      return await this.prefs.localeFor(customerId);
    } catch (e) {
      this.logger.warn(`locale unreadable, writing Indonesian: ${(e as Error).message}`);
      return 'id';
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
  /**
   * Who a depot alert is for: the depot's own staff and, for the alerts that say something is
   * wrong (stock, meters, couriers), the supervisors and managers above it. An unreadable
   * overseer lookup costs only those extra people, never the depot's own staff.
   */
  private async recipientsForDepot(event: NotificationEvent, depotId: string): Promise<string[]> {
    const own = await this.depotStaff!.staffIdsForDepot(depotId);
    if (!this.overseers || !OVERSEER_EVENTS.includes(event)) return own;
    try {
      return [...new Set([...own, ...(await this.overseers.overseersOfDepot(depotId))])];
    } catch (e) {
      this.logger.warn(`overseers of depot ${depotId} unreadable, depot staff only: ${(e as Error).message}`);
      return own;
    }
  }

  private pushToDepotStaff(event: NotificationEvent, message: string, depotId: string, vars: Record<string, string>): void {
    if (!this.depotStaff) return;
    void this.recipientsForDepot(event, depotId)
      .then(async (ids) => {
        if (ids.length === 0) {
          this.logger.warn(`${event} for depot ${depotId}: no staff to push to`);
          return;
        }
        const wanted = await this.withoutOptedOut(ids, event);
        const optedOut = ids.length - wanted.length;
        const results = await Promise.allSettled(
          wanted.map((id) =>
            this.push.sendToCustomer(id, {
              title: 'Hydromart',
              body: message,
              url: destinationFor(event, vars),
            }),
          ),
        );
        // One line per alert: how many staff, how many had a registered device, how many
        // got it. "0 devices" means nobody has registered the app, not that FCM failed.
        let devices = 0;
        let delivered = 0;
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            devices += r.value.devices;
            delivered += r.value.delivered;
          }
        }
        this.logger.log(
          `${event} depot ${depotId}: ${ids.length} staff, ${optedOut} opted out, ${devices} devices, ${delivered} delivered`,
        );
      })
      .catch((e) => this.logger.warn(`Ops push for ${event} failed: ${(e as Error).message}`));
  }

  /**
   * Drop the staff who switched push off for this kind of alert on their settings screen.
   *
   * Fails OPEN: if admin-service cannot be reached nobody is dropped, because an alert nobody
   * sees costs more than one a person asked not to get. An event without a switch is untouched.
   */
  private async withoutOptedOut(ids: string[], event: NotificationEvent): Promise<string[]> {
    const toggle = STAFF_TOGGLE_FOR_EVENT[event];
    if (!toggle || !this.staffPrefs || ids.length === 0) return ids;
    try {
      const off = await this.staffPrefs.pushDisabled(ids, toggle);
      return off.size === 0 ? ids : ids.filter((id) => !off.has(id));
    } catch (e) {
      this.logger.warn(`staff prefs unreadable for ${event}, sending to all: ${(e as Error).message}`);
      return ids;
    }
  }

  async notify(
    event: NotificationEvent,
    phone: string,
    vars: Record<string, string>,
    customerId: string | null = null,
    depotId: string | null = null,
  ): Promise<NotificationRecord> {
    const message = renderMessage(templateFor(event, await this.localeFor(customerId, event)), vars);
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
      // O6: which depot this row belongs to. Null for customer rows — a customer's order
      // update is not a depot's alert — and null for every ops row written before the
      // column existed.
      depotId: OPS_EVENTS.includes(event) ? depotId : null,
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
        // An alert addressed to one staff account (an approval waiting on them) honours that
        // person's own switch, exactly as a depot-wide one does.
        .then(async (allowed) =>
          allowed && (await this.withoutOptedOut([customerId], event)).length > 0
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
  async listOpsFeed(
    staffId: string,
    depotIds?: readonly string[],
    limit = 50,
  ): Promise<OpsNotificationRecord[]> {
    return this.repo.listOpsFeedFor(OPS_EVENTS, staffId, clampLimit(limit), depotIds);
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
