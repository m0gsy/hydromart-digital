import { BadRequestException } from '@nestjs/common';

import { BUSINESS_TIME_ZONE, dayStartUtc, localDayKey } from '@hydromart/platform';

/** HD-6: the calendar the AI read API reckons in. One zone, never the caller's. */
export type PeriodUnit = 'day' | 'week' | 'month' | 'year' | 'range';
export const PERIOD_UNITS = ['day', 'week', 'month', 'year'] as const;

export interface PeriodQuery {
  /** A whole calendar period; `date` (any day inside it) picks which, default today. */
  period?: string;
  date?: string;
  /** Or an explicit range of days, both ends included. */
  from?: string;
  to?: string;
  /** AI-7a: `depot` answers per depot, for the few metrics that are plain depot sums. */
  split?: string;
}

/** The period as answered: always echoed back, so an answer never leaves the reader guessing. */
export interface ResolvedPeriod {
  unit: PeriodUnit;
  /** First and last day, `YYYY-MM-DD` in WIB, both included. */
  from: string;
  to: string;
  timeZone: string;
  /** The same span as UTC instants, `[fromAt, toAt)`, for the services' own range filters. */
  fromAt: string;
  toAt: string;
}

/** The longest explicit range: a leap year. Longer is a report, not an answer. */
export const MAX_RANGE_DAYS = 366;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function fmt(ms: number): string {
  // tz-ok: these are calendar days held as UTC midnights; the UTC slice IS the calendar day.
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDay(text: string, what: string): number {
  const m = DAY.exec(text);
  const ms = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  // The round trip refuses 2026-02-30 rather than letting it roll over into March.
  // Year 9999 + 1 day is past what a Date can hold: refuse it here instead of a RangeError 500.
  if (Number.isNaN(ms) || Number(m?.[1]) > 9998 || fmt(ms) !== text) {
    throw new BadRequestException(`${what} harus tanggal kalender YYYY-MM-DD yang sah`);
  }
  return ms;
}

function monthEnd(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
}

/** Monday of the week holding `ms` (ISO weeks, as the business reckons them). */
function weekStart(ms: number): number {
  return ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;
}

function span(unit: PeriodUnit, from: number, to: number, timeZone: string): ResolvedPeriod {
  const f = fmt(from);
  const t = fmt(to);
  return {
    unit,
    from: f,
    to: t,
    timeZone,
    fromAt: dayStartUtc(f, timeZone).toISOString(),
    toAt: dayStartUtc(fmt(to + DAY_MS), timeZone).toISOString(),
  };
}

/** Whether `[from, to]` is a run of whole `unit`s (a month metric may not be asked over 5-20 Nov). */
function isWhole(unit: 'week' | 'month' | 'year', from: number, to: number): boolean {
  const a = new Date(from);
  const b = new Date(to);
  if (unit === 'week') return weekStart(from) === from && weekStart(to) + 6 * DAY_MS === to;
  if (unit === 'month') return a.getUTCDate() === 1 && monthEnd(to) === to;
  return a.getUTCMonth() === 0 && a.getUTCDate() === 1 && b.getUTCMonth() === 11 && b.getUTCDate() === 31;
}

export interface ParseOptions {
  /** The metric is only defined over whole units: an explicit range must be a run of them. */
  whole?: 'week' | 'month' | 'year';
  timeZone?: string;
}

/**
 * HD-6: the WIB calendar period of a question. Either `period` (+ `date`) names one whole
 * day/week/month/year, or `from`+`to` name a range of days. Nothing else is guessed: asking for
 * both, or for neither, is refused, and so is a range that runs backwards, is longer than a leap
 * year, or (when the metric needs it) is not a run of whole weeks/months/years.
 */
export function parsePeriod(query: PeriodQuery, now: Date, options: ParseOptions = {}): ResolvedPeriod {
  const tz = options.timeZone ?? BUSINESS_TIME_ZONE;
  const hasRange = query.from !== undefined || query.to !== undefined;
  if (hasRange === (query.period !== undefined)) {
    throw new BadRequestException('Sebutkan periode ATAU rentang (from dan to), salah satu saja');
  }
  if (hasRange) {
    if (query.from === undefined || query.to === undefined || query.date !== undefined) {
      throw new BadRequestException('Rentang butuh from dan to, tanpa date');
    }
    const from = parseDay(query.from, 'from');
    const to = parseDay(query.to, 'to');
    if (from > to) throw new BadRequestException('from tidak boleh sesudah to');
    if ((to - from) / DAY_MS + 1 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Rentang paling panjang ${MAX_RANGE_DAYS} hari`);
    }
    if (options.whole && !isWhole(options.whole, from, to)) {
      throw new BadRequestException(`Metrik ini hanya untuk ${options.whole} penuh, bukan rentang bebas`);
    }
    return span('range', from, to, tz);
  }
  const unit = query.period as string;
  if (!(PERIOD_UNITS as readonly string[]).includes(unit)) {
    throw new BadRequestException(`period harus salah satu dari ${PERIOD_UNITS.join(', ')}`);
  }
  const day = parseDay(query.date ?? localDayKey(now, tz), 'date');
  const d = new Date(day);
  const y = d.getUTCFullYear();
  if (unit === 'day') return span('day', day, day, tz);
  if (unit === 'week') return span('week', weekStart(day), weekStart(day) + 6 * DAY_MS, tz);
  if (unit === 'month') return span('month', Date.UTC(y, d.getUTCMonth(), 1), monthEnd(day), tz);
  return span('year', Date.UTC(y, 0, 1), Date.UTC(y, 11, 31), tz);
}
