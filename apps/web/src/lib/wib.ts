/**
 * C3 — the business day, in the business timezone, for the browser.
 *
 * Two wrong answers were in the codebase, and both look right in Jakarta:
 *
 *  1. `new Date().toISOString().slice(0, 10)` is the UTC day. Between 00:00 and 07:00 WIB it
 *     names YESTERDAY, so every "today" filter, every default date input and every report
 *     opened before breakfast asked the server for the wrong day. Fourteen files did this.
 *  2. `new Date(Date.now() + 7 * 3600 * 1000)` shifts the clock and then reads UTC fields
 *     off it. It gets the right answer only while the offset is exactly +7 and the machine
 *     is not already in WIB — and it is arithmetic on a timezone, which is the class of code
 *     that breaks silently rather than loudly. Three courier screens did this.
 *
 * `Intl` knows the offset; nothing here needs to. `en-CA` is used deliberately because it
 * formats as `YYYY-MM-DD`, which is the shape every API in this repo takes.
 *
 * The server-side rule is the mirror of this one: `"createdAt" AT TIME ZONE 'UTC' AT TIME
 * ZONE <tz>` (see scripts/check-tz-usage.mjs). Same day boundary, both ends.
 */

/*
 * The business timezone. One constant, so a future depot in WITA changes one line.
 *
 * Defined in its own module and re-exported here: `opening-hours.ts` needs the zone and
 * nothing else, and it runs on the home page, whose request count sits one below its
 * Lighthouse ceiling — importing it from here would drag the formatters below along with it.
 * Every existing importer keeps working; there is still only one definition.
 */
export { BUSINESS_TZ } from './business-tz';
import { BUSINESS_TZ } from './business-tz';

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` of the given instant (default: now) in the business timezone. */
export function todayWib(at: Date = new Date()): string {
  return dayFmt.format(at);
}

/** `YYYY-MM` of the given instant (default: now) in the business timezone. */
export function monthWib(at: Date = new Date()): string {
  return todayWib(at).slice(0, 7);
}

/**
 * The date parts of an instant as they read in the business timezone. For the callers that
 * need to do calendar arithmetic (the Monday of this week, the start of the month) rather
 * than just print a day — doing that on the UTC parts is how the courier screens went wrong.
 */
export function wibParts(at: Date = new Date()): { year: number; month: number; day: number } {
  // Destructuring gives `number | undefined` under `noUncheckedIndexedAccess`, and defaulting
  // a date part to 0 would be worse than a type error — a silent 1899. `Intl` always yields
  // exactly three parts for this format, so index them and say so.
  const parts = todayWib(at).split('-');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

/**
 * `YYYY-MM-DD`, `n` days from today, on the BUSINESS calendar.
 *
 * CA-3-21: the subscription form walked the DEVICE clock forward and then printed
 * `toISOString()`, which is UTC. Between 00.00 and 07.00 WIB the UTC date is still
 * yesterday, so "besok" came out as today — the default first delivery for anyone starting
 * a subscription overnight was a date that had already begun, and the date input then
 * refused it against its own `min`.
 *
 * The parts come from `wibParts` and the arithmetic happens at UTC midnight, which is what
 * `mondayWib` below already does: a calendar day has no offset once it is only a date.
 */
export function dateInDaysWib(n: number, at: Date = new Date()): string {
  const { year, month, day } = wibParts(at);
  return new Date(Date.UTC(year, month - 1, day + n)).toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` of the Monday of the week containing `at`, in the business timezone.
 * Monday because that is where the courier performance week starts.
 */
export function mondayWib(at: Date = new Date()): string {
  const { year, month, day } = wibParts(at);
  // Built at UTC midnight from WIB parts: the weekday of a date is a property of the date,
  // and this keeps the arithmetic away from any offset at all.
  const d = new Date(Date.UTC(year, month - 1, day));
  // getUTCDay: 0=Sunday. Monday-based offset, so Sunday walks back six days, not forward one.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
