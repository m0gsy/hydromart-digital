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
