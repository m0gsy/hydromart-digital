// Delivery scheduling on the client (PRD FR-036 / FR-052). order-service stores the real instant a
// booked slot STARTS; depot slots are Jakarta wall-clock windows ("09.00-11.00"), so the day has to
// be counted on the Jakarta calendar whatever zone the device is in. Jakarta has no daylight
// saving, so a fixed +07:00 offset is exact.

import { dateInDaysWib } from './wib';

// The value checkout writes for "antar sekarang" — the same literal as checkout/page.tsx and
// order-service's domain/delivery-schedule.ts, pinned equal by test/express-window-constant.test.ts.
const EXPRESS_WINDOW = 'Antar sekarang (express)';

/** Whether an order's window is the express marker: express has no slot to move. */
export function isExpressWindow(window: string | null | undefined): boolean {
  return window === EXPRESS_WINDOW;
}


/** ISO instant at which `slot` starts on the day `dayOffset` days from today (Jakarta), or null. */
export function slotInstant(
  dayOffset: number,
  slot: string,
  now: Date = new Date(),
): string | null {
  const m = /^(\d{2})\.(\d{2})-/.exec(slot);
  if (!m) return null;
  const day = dateInDaysWib(dayOffset, now);
  return new Date(`${day}T${m[1]}:${m[2]}:00+07:00`).toISOString();
}

/** "Sel, 1 Sep 09.00" for a booked instant, in Jakarta time; '' when there is none. */
export function formatSchedule(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  }).format(new Date(iso));
}

/** The Jakarta calendar day `dayOffset` days from today, `YYYY-MM-DD` — the form a depot lists its closed days in. */
export function dayKey(dayOffset: number, now: Date = new Date()): string {
  return dateInDaysWib(dayOffset, now);
}

/** "Sel, 1 Sep" for the day `dayOffset` days from today (Jakarta), for the day picker. */
export function dayLabel(dayOffset: number, locale: string, now: Date = new Date()): string {
  const day = new Date(now.getTime() + dayOffset * 86_400_000);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(day);
}
