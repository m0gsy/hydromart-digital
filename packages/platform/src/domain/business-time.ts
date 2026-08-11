/**
 * The single timezone policy for the platform.
 *
 * Hydromart runs in one business timezone (WIB, Asia/Jakarta, UTC+7, no DST), but the
 * code did not: some services read `PRICING_TZ`, some hardcoded a `+07:00` offset, and
 * several built "today" or "this month" out of `Date.UTC(...)`/`getUTC*`. A UTC day
 * boundary is 07:00 WIB, so every one of those reports moved seven hours of business into
 * the wrong bucket — which is why the same day's revenue disagreed depending on which
 * screen asked.
 *
 * Everything here takes the zone explicitly. Services pass their configured
 * `PRICING_TZ`; `BUSINESS_TIME_ZONE` is the default that config falls back to, so there
 * is exactly one place the default lives.
 */

/** Default IANA zone for every business day/month boundary. */
export const BUSINESS_TIME_ZONE = 'Asia/Jakarta';

/**
 * The zone's offset from UTC at `at`, in milliseconds (+7h for WIB).
 *
 * Derived from `Intl` rather than a constant so a zone with DST — or a future
 * multi-country deployment — is not silently wrong.
 */
export function zoneOffsetMs(at: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  // Read into a record rather than `find(...)?.value ?? '0'` per field: every field above
  // was explicitly requested, so a missing one is impossible — and a `?? '0'` default
  // would turn an impossible ICU failure into a plausible-looking wrong date rather than
  // an obviously broken one. A missing field yields NaN here, which fails loudly.
  const part = Object.fromEntries(
    parts.map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  // `hour` comes back as 24 for midnight under hour12:false in some ICU versions.
  const asIfUtc = Date.UTC(
    part.year,
    part.month - 1,
    part.day,
    part.hour % 24,
    part.minute,
    part.second,
  );
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The local calendar date at `at`, as `YYYY-MM-DD`. This is what "which day" means. */
export function localDayKey(at: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD; the same trick order-status.ts already relied on.
  return at.toLocaleDateString('en-CA', { timeZone });
}

/** The local calendar month at `at`, as `YYYY-MM`. */
export function localMonthKey(at: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return localDayKey(at, timeZone).slice(0, 7);
}

/** Local wall-clock hour 0..23 at `at`. */
export function localHour(at: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  // Shift the instant by the zone offset and read it as UTC — one primitive instead of a
  // second Intl format with its own parsing.
  return new Date(at.getTime() + zoneOffsetMs(at, timeZone)).getUTCHours();
}

/**
 * Minutes since local midnight, 0..1439 (C4).
 *
 * Attendance needs the wall-clock minute a punch happened at, not just the hour — lateness
 * is measured in minutes. hr-service used to derive this from its own `Intl` block; one
 * copy per service is how two of them drift apart.
 */
export function localMinutesOfDay(at: Date, timeZone: string = BUSINESS_TIME_ZONE): number {
  const shifted = new Date(at.getTime() + zoneOffsetMs(at, timeZone));
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * The UTC instant at which the local day `YYYY-MM-DD` begins.
 *
 * Two passes: guess the instant as if the key were UTC, read the zone's offset there,
 * correct, then re-read the offset at the corrected instant in case the correction
 * crossed a DST transition. WIB never needs the second pass; zones that do, get it.
 */
export function dayStartUtc(dayKey: string, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const guess = Date.parse(`${dayKey}T00:00:00Z`);
  if (Number.isNaN(guess)) throw new RangeError(`Bukan tanggal YYYY-MM-DD yang sah: ${dayKey}`);
  let instant = guess - zoneOffsetMs(new Date(guess), timeZone);
  instant = guess - zoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/** Start of the local day containing `at`, as a UTC instant. */
export function startOfLocalDay(at: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  return dayStartUtc(localDayKey(at, timeZone), timeZone);
}

/** `[from, to)` covering the local day containing `at`. */
export function localDayRange(
  at: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): { from: Date; to: Date } {
  const from = startOfLocalDay(at, timeZone);
  return { from, to: addLocalDays(from, 1, timeZone) };
}

/** `n` local days after the local day of `at`, at local midnight. */
export function addLocalDays(at: Date, n: number, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const [y, m, d] = localDayKey(at, timeZone).split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + n));
  // tz-ok: `shifted` already carries the zone offset, so reading it as UTC IS reading it
  // locally — this is the primitive the rest of the platform is told to use.
  return dayStartUtc(shifted.toISOString().slice(0, 10), timeZone);
}

/** Start of the local month containing `at`, as a UTC instant. */
export function startOfLocalMonth(at: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  return dayStartUtc(`${localMonthKey(at, timeZone)}-01`, timeZone);
}

/** `n` local months after the local month of `at`, at local midnight on the 1st. */
export function addLocalMonths(at: Date, n: number, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const [y, m] = localMonthKey(at, timeZone).split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1 + n, 1));
  // tz-ok: `shifted` already carries the zone offset, so reading it as UTC IS reading it
  // locally — this is the primitive the rest of the platform is told to use.
  return dayStartUtc(shifted.toISOString().slice(0, 10), timeZone);
}

/** `[from, to)` covering the local month containing `at`. */
export function localMonthRange(
  at: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): { from: Date; to: Date } {
  const from = startOfLocalMonth(at, timeZone);
  return { from, to: addLocalMonths(from, 1, timeZone) };
}
