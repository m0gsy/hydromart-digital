import { localMinutesOfDay } from '@hydromart/platform';

// Delivery scheduling (PRD FR-036 / FR-052). Framework-free so the rules can be pinned by tests.
//
// A depot's slots are wall-clock windows in Jakarta time ("09.00-11.00"). An order that is
// scheduled stores the real instant the window STARTS, so the booked day survives in the row —
// the free-form `deliveryWindow` label never carried it ("Kam, 09.00-11.00" does not say WHICH
// Thursday). The wall clock comes from the shared
// business-time helpers, so every service reads "09:00" the same way.

/**
 * What checkout stores in `deliveryWindow` when the customer wants "antar sekarang". The
 * lifecycle sweep matches this exact string, so it must stay byte-identical to the checkout
 * screen's copy (pinned by apps/web/test/express-window-constant.test.ts).
 */
export const EXPRESS_WINDOW = 'Antar sekarang (express)';

/** A slot must start at least this long from now: the depot needs time to prepare. */
export const SCHEDULE_MIN_LEAD_MINUTES = 30;
/** How far ahead a delivery can be booked — the checkout screen offers today plus three days. */
export const SCHEDULE_HORIZON_DAYS = 4;
/** A customer can move their own slot until this long before it starts. */
export const RESCHEDULE_CUTOFF_MINUTES = 120;

/** Minutes after midnight at which an `HH.MM-HH.MM` window starts, or null if it is not one. */
export function slotStartMinutes(slot: string): number | null {
  const m = /^(\d{2})\.(\d{2})-\d{2}\.\d{2}$/.exec(slot);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutes after midnight, Jakarta wall-clock, of an instant. */
export const wibMinutesOfDay = (at: Date): number => localMinutesOfDay(at);

export type ScheduleVerdict =
  | { ok: true; slot: string }
  | { ok: false; reason: 'NOT_A_SLOT' | 'TOO_SOON' | 'BEYOND_HORIZON' };

/** Whether `at` is an instant a customer may book, given the depot's slots. */
export function validateSchedule(input: { at: Date; slots: string[]; now: Date }): ScheduleVerdict {
  const { at, slots, now } = input;
  const minutes = wibMinutesOfDay(at);
  const slot = slots.find((s) => slotStartMinutes(s) === minutes);
  if (!slot || at.getUTCSeconds() !== 0 || at.getUTCMilliseconds() !== 0) {
    return { ok: false, reason: 'NOT_A_SLOT' };
  }
  if (at.getTime() < now.getTime() + SCHEDULE_MIN_LEAD_MINUTES * 60_000) {
    return { ok: false, reason: 'TOO_SOON' };
  }
  if (at.getTime() > now.getTime() + SCHEDULE_HORIZON_DAYS * 86_400_000) {
    return { ok: false, reason: 'BEYOND_HORIZON' };
  }
  return { ok: true, slot };
}
