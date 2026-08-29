// Depot SOP: is the depot open right now? Pure — takes the blob depot-service stores and
// an instant, and answers in the depot's own time zone. Used to stop offering "antar
// sekarang" while the counter is shut or on its lunch break.
//
// Deliberately NOT used to block scheduled orders: a customer may order at 22:00 for
// tomorrow morning. Only the immediate-delivery upgrade depends on someone being there.

import { localDayKey } from '@hydromart/platform';

export interface DayHours {
  open: string;
  close: string;
  /** Optional midday closure. Both must be set for the break to count. */
  breakStart?: string;
  breakEnd?: string;
}

/** Keyed by the same three-letter day names the console writes: mon…sun. */
export type OperatingHours = Record<string, DayHours | undefined>;

export interface Holiday {
  date: string;
  label?: string;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** 'HH:MM' → minutes since midnight, or null when it is not a time at all. */
function minutesOf(hhmm: string | undefined): number | null {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Whether the depot is serving at `now`.
 *
 * SHUT is the default when nothing is configured. This used to answer OPEN, reasoning that
 * an empty/absent `operatingHours` is a depot that never filled the form in rather than one
 * that is permanently closed, and that reading it as shut would silently withdraw express
 * from every existing depot. Measured against production, that default sells: depot
 * DEMO-01 "Depot Demo (Play Review)" is ACTIVE and public in Malang with
 * `operatingHours: {}`, so anyone inside its 3 km radius could buy an immediate cash
 * delivery from it at any hour of any day. Absence is not a safe value — the same call the
 * Prometheus alerting rules had to make. A depot that has not said when it trades has not
 * said it trades now, and the failure it buys is a delivery nobody is there to make.
 *
 * Note what this does NOT decide. A depot-service outage never reaches here at all:
 * order.service `depotIsOpen` keeps express on when the directory cannot answer, because
 * not knowing and knowing that nothing is configured are different facts.
 *
 * A listed holiday date closes the whole day. A day with no entry is a weekly closing day.
 * `close` at or before `open` (an overnight depot) is treated as open all day rather than
 * as a negative window.
 */
export function isOpenAt(
  hours: OperatingHours | null | undefined,
  holidays: Holiday[] | null | undefined,
  now: Date,
  tz: string,
): boolean {
  if (!hours || Object.keys(hours).length === 0) return false;

  const day = localDayKey(now, tz);
  if (holidays?.some((h) => h?.date === day)) return false;

  // The local wall clock, read through the same tz the day key came from.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const at = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const nowMinutes = Number(at('hour')) * 60 + Number(at('minute'));
  const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();

  const today = hours[DAY_KEYS[weekday]];
  if (!today) return false; // no entry for this weekday = closed that day

  const open = minutesOf(today.open);
  const close = minutesOf(today.close);
  if (open === null || close === null || close <= open) return true; // unreadable = open

  if (nowMinutes < open || nowMinutes >= close) return false;

  const breakStart = minutesOf(today.breakStart);
  const breakEnd = minutesOf(today.breakEnd);
  if (breakStart !== null && breakEnd !== null && breakEnd > breakStart) {
    if (nowMinutes >= breakStart && nowMinutes < breakEnd) return false;
  }
  return true;
}
