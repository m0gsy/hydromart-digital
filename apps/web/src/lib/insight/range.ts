/**
 * The windows the insight dashboard asks for, as the ISO instants the API takes.
 *
 * Every bound is the START of a business day in WIB. The server parses a date-only string as
 * UTC midnight (07:00 WIB), so a window built from one drops the first seven hours of its
 * first day; and `to` is EXCLUSIVE everywhere, so "through the 31st" is the 1st of next month.
 *
 * All of it is calendar arithmetic on dates, never on the device clock plus an offset: a
 * calendar day has no offset once it is only a date.
 */
import { dayStartWib, mondayWib, monthRangeWib, todayWib } from '@/lib/wib';

export type Preset = 'today' | 'week' | 'month' | 'custom';
export type Grouping = 'day' | 'week' | 'month' | 'quarter';

export interface InsightRange {
  from: string;
  to: string;
  /** What the window was built from, so the previous period can honour it (a month, not 30 days). */
  preset: Preset;
}

/** Longest window the API accepts (`IsWithinDays`): a year and a day. */
export const MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` + n calendar days, with no clock or offset involved. */
function addDays(date: string, n: number): string {
  const parts = date.split('-');
  const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + n));
  // tz-ok: built at UTC midnight from a plain date, so the slice reads the same date back.
  return d.toISOString().slice(0, 10);
}

/** The window for a preset, relative to `now`. `custom` takes inclusive `YYYY-MM-DD` dates. */
export function rangeFor(
  preset: Preset,
  now: Date = new Date(),
  custom?: { from: string; to: string },
): InsightRange {
  if (preset === 'today') {
    const day = todayWib(now);
    return { from: dayStartWib(day), to: dayStartWib(addDays(day, 1)), preset };
  }
  if (preset === 'week') {
    const monday = mondayWib(now);
    return { from: dayStartWib(monday), to: dayStartWib(addDays(monday, 7)), preset };
  }
  if (preset === 'month' || !custom) {
    return { ...monthRangeWib(now), preset: 'month' };
  }
  // A custom end date is inclusive on screen and exclusive on the wire.
  return { from: dayStartWib(custom.from), to: dayStartWib(addDays(custom.to, 1)), preset };
}

/** Whole days a window spans (a business day is 24h: Indonesia keeps no daylight saving). */
export function spanDays(range: Pick<InsightRange, 'from' | 'to'>): number {
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / MS_PER_DAY);
}

/** Whether the API will take this window: forward, and no longer than a year and a day. */
export function isValidRange(range: Pick<InsightRange, 'from' | 'to'>): boolean {
  const days = spanDays(range);
  return Number.isFinite(days) && days >= 1 && days <= MAX_RANGE_DAYS;
}

/**
 * The window right before this one, for "vs previous period".
 * A month compares with the previous CALENDAR month (not 30 days back); anything else with the
 * same number of days immediately before it.
 */
export function previousRange(range: InsightRange): InsightRange {
  if (range.preset === 'month') {
    const inPrev = new Date(Date.parse(range.from) - 1);
    return { ...monthRangeWib(inPrev), preset: 'month' };
  }
  const fromDate = todayWib(new Date(range.from));
  return {
    from: dayStartWib(addDays(fromDate, -spanDays(range))),
    to: range.from,
    preset: range.preset,
  };
}

/** `YYYY-MM-DD` with its year moved back by one, 29 February falling to the 28th. */
function yearBack(date: string): string {
  const [y, m, d] = date.split('-');
  const year = Number(y) - 1;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === '02' && d === '29' && !leap ? '28' : d;
  return `${String(year).padStart(4, '0')}-${m}-${day}`;
}

/** The same window one calendar year earlier, for "vs the same period last year". */
export function yearAgoRange(range: InsightRange): InsightRange {
  return {
    from: dayStartWib(yearBack(todayWib(new Date(range.from)))),
    to: dayStartWib(yearBack(todayWib(new Date(range.to)))),
    preset: range.preset,
  };
}

/** The business date of an ISO instant, for labelling a window. */
export function dateOf(instant: string): string {
  return todayWib(new Date(instant));
}

/** One bucket of a sales series. */
export interface SalesBucketLike {
  period: string;
  orderCount: number;
  revenue: number;
}

/**
 * Fold a daily or monthly series into the grouping the user picked.
 *
 * Buckets arrive labelled `YYYY-MM-DD` (daily) or `YYYY-MM` (monthly), already cut in WIB by
 * the server, so grouping only ever reads the label — it never re-parses an instant.
 * A monthly series cannot be split into weeks or days, so those groupings are not offered for
 * it (see `groupingsFor`).
 */
export function regroup(
  buckets: readonly SalesBucketLike[],
  grouping: Grouping,
): SalesBucketLike[] {
  const keyOf = (period: string): string => {
    if (grouping === 'day') return period;
    if (grouping === 'month') return period.slice(0, 7);
    if (grouping === 'quarter') {
      return `${period.slice(0, 4)}-Q${Math.ceil(Number(period.slice(5, 7)) / 3)}`;
    }
    // week: the Monday of the week the day falls in, as a plain date.
    const parts = period.split('-');
    const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    // tz-ok: built at UTC midnight from a plain date, so the slice reads the same date back.
    return d.toISOString().slice(0, 10);
  };
  const out = new Map<string, SalesBucketLike>();
  for (const b of buckets) {
    const k = keyOf(b.period);
    const cur = out.get(k) ?? { period: k, orderCount: 0, revenue: 0 };
    cur.orderCount += b.orderCount;
    cur.revenue += b.revenue;
    out.set(k, cur);
  }
  return [...out.values()].sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Groupings that make sense for a window. A daily series of a year is unreadable and costs the
 * server a bucket per day, so a long window is read by the week at the finest.
 */
export function groupingsFor(range: Pick<InsightRange, 'from' | 'to'>): Grouping[] {
  const days = spanDays(range);
  if (days <= 31) return ['day', 'week'];
  if (days <= 92) return ['day', 'week', 'month'];
  return ['week', 'month', 'quarter'];
}

/** Which server granularity feeds a grouping: month and quarter come from the monthly series. */
export function granularityFor(grouping: Grouping): 'daily' | 'monthly' {
  return grouping === 'month' || grouping === 'quarter' ? 'monthly' : 'daily';
}
