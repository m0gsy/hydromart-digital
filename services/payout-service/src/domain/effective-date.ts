import { InvalidEffectiveDateError } from './errors';

import { dayStartUtc, localDayKey } from '@hydromart/platform';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The instant a rule or scheme takes effect. A date-only value ("2026-08-01") means the
 * start of that day in the business zone; `new Date('2026-08-01')` is midnight UTC, i.e.
 * 07:00 WIB, so the rule would start seven hours late. A full ISO timestamp is already an
 * instant and is kept as is.
 *
 * An impossible day ("2026-02-30") would silently roll over to 2 March and schedule a money
 * rule on another day, so the result must read back as the same day key or it is refused.
 */
export function effectiveFrom(value: string, timeZone: string): Date {
  if (!DATE_ONLY.test(value)) return new Date(value);
  const at = dayStartUtc(value, timeZone);
  if (localDayKey(at, timeZone) !== value) {
    throw new InvalidEffectiveDateError(value);
  }
  return at;
}
