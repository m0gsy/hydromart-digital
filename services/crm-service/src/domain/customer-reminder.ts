import { localDayKey } from '@hydromart/platform';

import { NotificationEvent } from './notification-event';

/**
 * HD-18: the three customer reminders n8n triggers. n8n only says "now" and which kind;
 * hydromart decides who is reminded, with what, and never sends the same reminder twice.
 */
export const CUSTOMER_REMINDER_KINDS = ['SUBSCRIPTION_TOMORROW', 'POINTS_EXPIRING', 'UNPAID_ORDER'] as const;
export type CustomerReminderKind = (typeof CUSTOMER_REMINDER_KINDS)[number];

export const REMINDER_EVENT: Record<CustomerReminderKind, NotificationEvent> = {
  SUBSCRIPTION_TOMORROW: NotificationEvent.SUBSCRIPTION_TOMORROW,
  POINTS_EXPIRING: NotificationEvent.POINTS_EXPIRING,
  UNPAID_ORDER: NotificationEvent.UNPAID_ORDER,
};

/** Lots expiring within this many days are reminded (owner decision 25 Nov 2026: the next 7 days). */
export const POINTS_EXPIRING_DAYS = 7;

/**
 * One reminder per (kind, thing reminded about), however often n8n calls: a subscription once per
 * delivery day, a point lot once, an order once. The key is what makes a retry send nothing twice.
 */
export const reminderDedupeKey = (kind: CustomerReminderKind, refId: string, day?: string): string =>
  `customer-reminder:${kind}:${refId}${day ? `:${day}` : ''}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** "26 Nov" for the WIB day an instant falls on. */
export function dayMonth(at: Date): string {
  const [, month, day] = localDayKey(at).split('-').map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "Rp45.000". */
export const rupiah = (n: number): string => `Rp${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
