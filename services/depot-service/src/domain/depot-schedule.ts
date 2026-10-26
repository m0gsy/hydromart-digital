/**
 * Strict reading of a depot's weekly hours and closure dates, for the bulk import.
 *
 * The create/update DTOs only check `IsObject`/`IsArray`, and the readers downstream are
 * forgiving in the dangerous direction: order-service treats an unreadable time, or a close
 * that is not after the open, as "open all day", and a weekday with no entry as closed. So a
 * typo in a spreadsheet does not fail — it silently changes when customers can order. Here a
 * bad cell is a failed row instead.
 */
import type { DayHours, Holiday, OperatingHours } from '../application/ports/depot.repository';

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_HOLIDAYS = 366;
export const MAX_HOLIDAY_LABEL = 100;

const blank = (v: unknown): boolean => v === undefined || v === null || v === '';

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** A time cell: `HH:MM`, 24 h, 00:00-23:59. Returns an error text, or null when fine. */
function timeError(label: string, value: unknown): string | null {
  if (typeof value === 'string' && HHMM.test(value)) return null;
  return `${label} "${String(value)}" bukan jam HH:MM (00:00-23:59)`;
}

/**
 * `{ mon: { open, close, breakStart?, breakEnd? }, ... }`. A day that is missing, null or has
 * every cell blank is CLOSED and left out of the result. Blank strings (what the depot hours
 * editor sends for a cleared break) are read as "not set".
 */
export function parseOperatingHours(input: unknown): Parsed<OperatingHours> {
  if (input === undefined || input === null) return { ok: true, value: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'jam operasional harus berupa objek per hari' };
  }
  const raw = input as Record<string, unknown>;
  const unknownDay = Object.keys(raw).find((k) => !(DAY_KEYS as readonly string[]).includes(k));
  if (unknownDay) return { ok: false, error: `hari "${unknownDay}" tidak dikenal` };

  const value: OperatingHours = {};
  for (const day of DAY_KEYS) {
    const entry = raw[day];
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `${day}: harus berupa objek jam` };
    }
    const e = entry as Record<string, unknown>;
    const extra = Object.keys(e).find(
      (k) => !['open', 'close', 'breakStart', 'breakEnd'].includes(k),
    );
    if (extra) return { ok: false, error: `${day}: kolom "${extra}" tidak dikenal` };

    const { open, close, breakStart, breakEnd } = e;
    if ([open, close, breakStart, breakEnd].every(blank)) continue;

    if (blank(open) || blank(close)) {
      return { ok: false, error: `${day}: jam buka dan jam tutup harus diisi bersama` };
    }
    const bad =
      timeError(`${day}: jam buka`, open) ?? timeError(`${day}: jam tutup`, close);
    if (bad) return { ok: false, error: bad };
    if (minutes(open as string) >= minutes(close as string)) {
      return { ok: false, error: `${day}: jam tutup harus setelah jam buka` };
    }

    const hours: DayHours = {
      open: open as string,
      close: close as string,
    };
    if (!blank(breakStart) || !blank(breakEnd)) {
      if (blank(breakStart) || blank(breakEnd)) {
        return { ok: false, error: `${day}: mulai dan selesai istirahat harus diisi bersama` };
      }
      const badBreak =
        timeError(`${day}: mulai istirahat`, breakStart) ??
        timeError(`${day}: selesai istirahat`, breakEnd);
      if (badBreak) return { ok: false, error: badBreak };
      const bs = minutes(breakStart as string);
      const be = minutes(breakEnd as string);
      if (bs >= be) {
        return { ok: false, error: `${day}: selesai istirahat harus setelah mulai istirahat` };
      }
      if (bs < minutes(hours.open) || be > minutes(hours.close)) {
        return { ok: false, error: `${day}: istirahat harus berada di dalam jam buka` };
      }
      hours.breakStart = breakStart as string;
      hours.breakEnd = breakEnd as string;
    }
    value[day] = hours;
  }
  return { ok: true, value };
}

function realDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** `[{ date: 'YYYY-MM-DD', label? }]`, calendar-valid, no repeats, sorted by date. */
export function parseHolidays(input: unknown): Parsed<Holiday[]> {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'hari libur harus berupa daftar' };
  if (input.length > MAX_HOLIDAYS) {
    return { ok: false, error: `hari libur maksimal ${MAX_HOLIDAYS} tanggal` };
  }
  const seen = new Set<string>();
  const out: Holiday[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'setiap hari libur harus berupa { date, label }' };
    }
    const { date, label, ...rest } = item as Record<string, unknown>;
    if (Object.keys(rest).length > 0) {
      return { ok: false, error: `hari libur: kolom "${Object.keys(rest)[0]}" tidak dikenal` };
    }
    const m = typeof date === 'string' ? DATE.exec(date) : null;
    if (!m || !realDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
      return { ok: false, error: `tanggal libur "${String(date)}" bukan tanggal YYYY-MM-DD yang valid` };
    }
    if (seen.has(date as string)) {
      return { ok: false, error: `tanggal libur ${date as string} muncul lebih dari sekali` };
    }
    seen.add(date as string);
    if (!blank(label) && typeof label !== 'string') {
      return { ok: false, error: `${date as string}: keterangan harus teks` };
    }
    const text = typeof label === 'string' ? label.trim() : '';
    if (text.length > MAX_HOLIDAY_LABEL) {
      return { ok: false, error: `${date as string}: keterangan maksimal ${MAX_HOLIDAY_LABEL} karakter` };
    }
    out.push(text ? { date: date as string, label: text } : { date: date as string });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, value: out };
}
