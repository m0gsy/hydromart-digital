import { dayStartUtc } from '@hydromart/platform';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instant a rule or scheme takes effect. A date-only value ("2026-08-01") means the
 * start of that day in the business zone; `new Date('2026-08-01')` is midnight UTC, i.e.
 * 07:00 WIB, so the rule would start seven hours late. A full ISO timestamp is already an
 * instant and is kept as is.
 */
export function effectiveFrom(value: string, timeZone: string): Date {
  return DATE_ONLY.test(value) ? dayStartUtc(value, timeZone) : new Date(value);
}
