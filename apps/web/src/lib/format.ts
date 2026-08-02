// Pure formatting helpers. Covered by test/format.test.ts.

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

const dateFmt = new Intl.DateTimeFormat('id-ID', {
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
