// Pure formatting helpers. Covered by test/format.test.ts.

import { BUSINESS_TZ } from './wib';

// Plain number grouping (id-ID uses "." as the thousands separator), then a
// literal "Rp " prefix — avoids the locale currency-symbol spacing (Intl inserts
// a non-breaking space) that makes the output awkward to assert on.
const rupiah = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

/** Format a number of Rupiah, e.g. 20000 -> "Rp 20.000". */
export function formatIDR(amount: number): string {
  return `Rp ${rupiah.format(amount)}`;
}

/**
 * Indonesian mobile in whatever form a person types it -> strict E.164 (`+628…`).
 * Everything else on the platform stores the local `08…` form, but the franchise
 * application DTO validates `^\+628\d{7,11}$`, so the form converts rather than
 * making an applicant learn a format. Returns the input untouched when it is not a
 * recognizable Indonesian mobile — the server rejects it and says why.
 */
export function toIndonesianE164(input: string): string {
  const digits = input.replace(/[\s-().]/g, '');
  if (/^\+628\d+$/.test(digits)) return digits;
  if (/^628\d+$/.test(digits)) return `+${digits}`;
  if (/^08\d+$/.test(digits)) return `+62${digits.slice(1)}`;
  if (/^8\d+$/.test(digits)) return `+62${digits}`;
  return input.trim();
}

/**
 * Name -> URL slug, matching the shape product-service validates
 * (`^[a-z0-9]+(?:-[a-z0-9]+)*$`): lowercase, runs of anything else become one hyphen,
 * no leading or trailing hyphen. Returns '' for a name with nothing sluggable in it,
 * which callers must treat as "ask the operator" rather than post an invalid slug.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// C3: `timeZone` is not optional here. Without it `Intl` formats in whatever zone the
// device is set to, so the same order timestamp reads differently on a courier's phone
// abroad, on a laptop left on UTC, and on a depot PC — and the one that is wrong is the one
// nobody is looking at. Every timestamp this app prints is a business event in WIB.
const dateFmt = new Intl.DateTimeFormat('id-ID', {
  timeZone: BUSINESS_TZ,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return dateFmt.format(d);
}

/**
 * Normalise an Indonesian mobile number to E.164-ish local form for display.
 * Leaves the value largely intact — the backend does authoritative validation.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.replace(/[\s-]/g, '');
  if (trimmed.startsWith('+')) return trimmed;
  if (trimmed.startsWith('0')) return trimmed;
  if (trimmed.startsWith('62')) return `+${trimmed}`;
  return trimmed;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

/**
 * Absolute URL for a stored media path (QRIS image, upload…). Anything already absolute is
 * returned untouched — that is what the storage adapters hand back now. Legacy rows still
 * hold a service-relative path, and those only resolve against the gateway; rendering them
 * raw is what broke the QRIS on the customer's payment screen while the console (which did
 * prepend) looked fine.
 */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
}

/*
 * Short weekday and month names, in the reader's language.
 *
 * Five screens carried their own `['Sen','Sel',…]` and `['Jan',…,'Des']` arrays, so an
 * English reader got Indonesian day and month labels on a roster, two pricing screens, a
 * courier performance chart and the checkout. `Intl` already knows every one of these
 * names in both languages, which beats twenty-odd dictionary keys nobody would keep in
 * step — and it produces exactly the strings the hardcoded arrays held.
 *
 * The two orderings both existed in the wild: a roster starts on Monday, a `daysOfWeek`
 * index from the API is JavaScript's own Sunday-first numbering. Hence the flag rather
 * than a second copy.
 */
const DAY_MS = 86_400_000;
const intlLocale = (locale: string) => (locale === 'en' ? 'en-GB' : 'id-ID');

export function shortWeekdays(locale: string, mondayFirst = true): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', timeZone: 'UTC' });
  // 2024-01-07 was a Sunday, so index 0 of this base is Sunday.
  const sunday = Date.UTC(2024, 0, 7);
  const order = mondayFirst ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  return order.map((d) => fmt.format(new Date(sunday + d * DAY_MS)));
}

export function shortMonths(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), { month: 'short', timeZone: 'UTC' });
  return Array.from({ length: 12 }, (_, m) => fmt.format(new Date(Date.UTC(2024, m, 1))));
}
