import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { addLocalDays, localDayKey } from '@hydromart/platform';

import {
  CustomerReminderKind,
  POINTS_EXPIRING_DAYS,
  REMINDER_EVENT,
  dayMonth,
  reminderDedupeKey,
  rupiah,
} from '../../domain/customer-reminder';
import { CustomerReminderSourcePort } from '../ports/customer-reminder-source.port';
import { CRM_TOKENS } from '../tokens';
import { NotificationService } from './notification.service';

export interface CustomerReminderResult {
  kind: CustomerReminderKind;
  date: string;
  candidates: number;
  notified: number;
  skipped: number;
  whatsapp: 'pending';
}

interface Reminder {
  customerId: string;
  dedupeKey: string;
  vars: Record<string, string>;
}

/**
 * HD-18, owner decision 25 Nov 2026: n8n schedules, hydromart decides. For one kind it asks the
 * owning service who is due, files one in-app notification each (customer inbox and push, through
 * the same path as every customer notice, so a customer who muted push gets the inbox row only)
 * and answers counts. Dedupe is the notification's own key, so a retry or a second cron tick sends
 * nothing twice and counts the already-sent as `skipped`.
 *
 * WhatsApp seam: reported `pending` and never faked. Sending there needs the per-number consent of
 * HD-13; when it exists, it belongs right after `notifyOnce` in `run`, for the rows it just created.
 */
@Injectable()
export class CustomerReminderService {
  private readonly logger = new Logger(CustomerReminderService.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(CRM_TOKENS.CustomerReminderSource) private readonly source: CustomerReminderSourcePort,
  ) {}

  /** THROWS 503 when the source cannot be read or any reminder could not be filed; the same call finishes the rest. */
  async run(kind: CustomerReminderKind, date: string, now: Date = new Date()): Promise<CustomerReminderResult> {
    const reminders = await this.candidates(kind, now).catch((e: Error) => {
      this.logger.warn(`customer reminders ${kind}: candidates unreadable: ${e.message}`);
      throw new ServiceUnavailableException('The recipients could not be read; retry the same call');
    });
    let notified = 0;
    let skipped = 0;
    let failed = 0;
    for (const r of reminders) {
      try {
        const { created } = await this.notifications.notifyOnce(
          REMINDER_EVENT[kind],
          '',
          r.vars,
          r.customerId,
          null,
          r.dedupeKey,
        );
        if (created) notified += 1;
        else skipped += 1;
      } catch (e) {
        failed += 1;
        this.logger.warn(`customer reminder ${r.dedupeKey} failed: ${(e as Error).message}`);
      }
    }
    if (failed > 0) {
      throw new ServiceUnavailableException(`${failed} reminder(s) could not be filed; retry the same call`);
    }
    return { kind, date, candidates: reminders.length, notified, skipped, whatsapp: 'pending' };
  }

  private async candidates(kind: CustomerReminderKind, now: Date): Promise<Reminder[]> {
    if (kind === 'SUBSCRIPTION_TOMORROW') {
      // Tomorrow in WIB: [tomorrow 00:00, day after 00:00).
      const due = await this.source.subscriptionsDue(addLocalDays(now, 1), addLocalDays(now, 2));
      return due.map((s) => ({
        customerId: s.customerId,
        dedupeKey: reminderDedupeKey(kind, s.id, localDayKey(s.nextDeliveryAt)),
        vars: { product: s.productName, quantity: String(s.quantity), date: dayMonth(s.nextDeliveryAt) },
      }));
    }
    if (kind === 'POINTS_EXPIRING') {
      const lots = await this.source.expiringPoints(POINTS_EXPIRING_DAYS);
      return lots.map((l) => ({
        customerId: l.customerId,
        dedupeKey: reminderDedupeKey(kind, l.lotId),
        vars: { points: String(l.points), expires: dayMonth(l.expiresAt) },
      }));
    }
    const orders = await this.source.unpaidOrders();
    return orders.map((o) => ({
      customerId: o.customerId,
      dedupeKey: reminderDedupeKey(kind, o.orderId),
      vars: { orderNumber: o.orderNumber, orderId: o.orderId, amount: rupiah(o.total) },
    }));
  }
}
