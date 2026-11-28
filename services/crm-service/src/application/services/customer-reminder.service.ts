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
  /** More were due than one answer holds; the next tick takes the rest. */
  truncated: boolean;
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
 * WhatsApp: reported `pending` and never faked. `notifyOnce` itself hands the rows it just created to
 * WhatsApp number 1 (HD-12, opted-in customers, SUBSCRIPTION_TOMORROW and UNPAID_ORDER only), after the
 * inbox row and the push; this result counts what was filed, not what Meta accepted.
 */
@Injectable()
export class CustomerReminderService {
  private readonly logger = new Logger(CustomerReminderService.name);

  constructor(
    private readonly notifications: NotificationService,
    @Inject(CRM_TOKENS.CustomerReminderSource) private readonly source: CustomerReminderSourcePort,
  ) {}

  /** THROWS 503 when the source cannot be read or any reminder could not be filed; the same call finishes the rest. */
  async run(
    kind: CustomerReminderKind,
    date: string,
    now: Date = new Date(),
  ): Promise<CustomerReminderResult> {
    const { reminders, truncated } = await this.candidates(kind, now).catch((e: Error) => {
      this.logger.warn(`customer reminders ${kind}: candidates unreadable: ${e.message}`);
      throw new ServiceUnavailableException(
        'The recipients could not be read; retry the same call',
      );
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
      throw new ServiceUnavailableException(
        `${failed} reminder(s) could not be filed; retry the same call`,
      );
    }
    if (truncated)
      this.logger.warn(
        `customer reminders ${kind}: source answer truncated, the next tick takes the rest`,
      );
    return {
      kind,
      date,
      candidates: reminders.length,
      truncated,
      notified,
      skipped,
      whatsapp: 'pending',
    };
  }

  private async candidates(
    kind: CustomerReminderKind,
    now: Date,
  ): Promise<{ reminders: Reminder[]; truncated: boolean }> {
    if (kind === 'SUBSCRIPTION_TOMORROW') {
      // Tomorrow in WIB: [tomorrow 00:00, day after 00:00).
      const { rows: due, truncated } = await this.source.subscriptionsDue(
        addLocalDays(now, 1),
        addLocalDays(now, 2),
      );
      return {
        truncated,
        reminders: due.map((s) => ({
          customerId: s.customerId,
          dedupeKey: reminderDedupeKey(kind, s.id, localDayKey(s.nextDeliveryAt)),
          vars: {
            product: s.productName,
            quantity: String(s.quantity),
            date: dayMonth(s.nextDeliveryAt),
          },
        })),
      };
    }
    if (kind === 'POINTS_EXPIRING') {
      const { rows: lots, truncated } = await this.source.expiringPoints(POINTS_EXPIRING_DAYS);
      return {
        truncated,
        reminders: lots.map((l) => ({
          customerId: l.customerId,
          dedupeKey: reminderDedupeKey(kind, l.lotId),
          vars: { points: String(l.points), expires: dayMonth(l.expiresAt) },
        })),
      };
    }
    const { rows: orders, truncated } = await this.source.unpaidOrders();
    return {
      truncated,
      reminders: orders.map((o) => ({
        customerId: o.customerId,
        dedupeKey: reminderDedupeKey(kind, o.orderId),
        vars: { orderNumber: o.orderNumber, orderId: o.orderId, amount: rupiah(o.total) },
      })),
    };
  }
}
